import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOrgDashboardSummary } from "@/hooks/useDashboardSummary";
import { QueryError, QueryLoading } from "@/components/QueryState";
import { useListAllResidentComplianceItems } from "@/hooks/useResidentComplianceItems";
import { useListResidents } from "@/hooks/useResidents";
import { useVisibleFacilityTypes } from "@/hooks/useVisibleFacilityTypes";
import { summarizeResidentComplianceAnalytics } from "@/lib/residentComplianceAnalytics";
import { facilityTypeLabel, hasAnyFacilityType, PCH_ALR_ONLY_FACILITY_TYPES } from "@/lib/facilityTypes";
import { toLocalIsoDate } from "@/lib/dateUtils";
import { useAuth } from "@/lib/auth";
import { useDailyOperationsCommandCenter } from "@/hooks/useDailyOperations";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Building2, Users, AlertTriangle, CheckCircle, Clock, XCircle, AlertCircle, ChevronRight, TrendingUp, Shield, Activity, UserPlus, FileText, LayoutGrid, Bell, GraduationCap, Upload, Download, Info, type LucideIcon } from "lucide-react";
import { Link } from "wouter";
import { supabase } from "@/lib/supabase";

interface RecentUpload {
  id: string;
  fileName: string;
  documentType: string;
  createdAt: string;
}

interface FacilityComplianceSummary {
  facilityId: string;
  facilityName: string;
  complianceScore: number;
}

interface DashboardSummary {
  compliantCount: number;
  dueSoon30Count: number;
  dueSoon90Count: number;
  expiredCount: number;
  missingDocumentCount: number;
  totalTrackedCount: number;
  compliancePercentage: number;
  totalEmployees: number;
  openAlertsCount: number;
  totalMedAdminStaff: number;
  trainersDueForRecert: number;
  recentUploadsCount: number;
  recentUploads: RecentUpload[];
  facilityCompliance: FacilityComplianceSummary[];
}

interface ActionItem {
  id: string;
  title: string;
  description: string;
  href: string;
  label: string;
  priority: "Critical" | "High" | "Medium";
  icon: LucideIcon;
}

function buildActionPlan({
  summary,
  criticalAlertsCount,
  facilities,
}: {
  summary: DashboardSummary;
  criticalAlertsCount: number;
  facilities: FacilityComplianceSummary[];
}): ActionItem[] {
  const lowestScoringFacility = facilities.reduce<FacilityComplianceSummary | undefined>(
    (lowest, facility) =>
      !lowest || facility.complianceScore < lowest.complianceScore
        ? facility
        : lowest,
    undefined,
  );
  const missingDocumentCount = summary.missingDocumentCount;
  const actions: ActionItem[] = [];

  if (criticalAlertsCount > 0) actions.push({
    id: "critical-alerts",
    title: `${criticalAlertsCount} critical alert${criticalAlertsCount === 1 ? "" : "s"} open`,
    description: "Review critical alerts before they become survey findings.",
    href: "/app/alerts",
    label: "Review alerts",
    priority: "Critical",
    icon: AlertCircle,
  });
  if (summary.expiredCount > 0) actions.push({
    id: "expired-training",
    title: `${summary.expiredCount} expired training record${summary.expiredCount === 1 ? "" : "s"}`,
    description: "Schedule retraining and update records for expired requirements.",
    href: "/app/reports",
    label: "Run expired report",
    priority: "Critical",
    icon: XCircle,
  });
  if (summary.dueSoon90Count > 0) actions.push({
    id: "due-soon",
    title: `${summary.dueSoon90Count} training item${summary.dueSoon90Count === 1 ? "" : "s"} due within 90 days`,
    description: "Prioritize upcoming renewals to avoid compliance gaps.",
    href: "/app/training-matrix",
    label: "Open matrix",
    priority: "High",
    icon: Clock,
  });
  if (missingDocumentCount > 0) actions.push({
    id: "missing-documents",
    title: `${missingDocumentCount} missing training document${missingDocumentCount === 1 ? "" : "s"}`,
    description: "Upload certificates, rosters, and supporting documentation.",
    href: "/app/documents",
    label: "Upload documents",
    priority: "High",
    icon: Upload,
  });
  if (lowestScoringFacility && lowestScoringFacility.complianceScore < 90) actions.push({
    id: "facility-focus",
    title: `${lowestScoringFacility.facilityName} is at ${lowestScoringFacility.complianceScore}%`,
    description: "Focus remediation on the facility with the lowest compliance score.",
    href: `/app/facilities/${lowestScoringFacility.facilityId}`,
    label: "View facility",
    priority: lowestScoringFacility.complianceScore < 75 ? "Critical" : "Medium",
    icon: Building2,
  });

  return actions.slice(0, 4);
}

function DonutChart({ percentage, size = 140, strokeWidth = 12 }: { percentage: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;
  const color = percentage >= 90 ? "#10b981" : percentage >= 75 ? "#f59e0b" : "#ef4444";
  const bgColor = percentage >= 90 ? "#d1fae5" : percentage >= 75 ? "#fef3c7" : "#fee2e2";

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Overall compliance: ${percentage} percent`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={bgColor}
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold tracking-tighter" style={{ color }}>{percentage}%</span>
        <span className="text-[10px] text-muted-foreground font-medium">Compliant</span>
      </div>
    </div>
  );
}

function StatLabel({ label, tooltip }: { label: string; tooltip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="stat-label inline-flex w-fit cursor-help items-center gap-1 rounded-sm border-0 bg-transparent p-0 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {label}
          <Info className="h-3 w-3 text-muted-foreground/50" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64 text-left">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

function StatCardSkeleton() {
  return (
    <div className="stat-card">
      <div className="flex items-start justify-between">
        <div>
          <Skeleton className="h-4 w-20 mb-2" />
          <Skeleton className="h-8 w-14" />
        </div>
        <Skeleton className="h-10 w-10 rounded-lg" />
      </div>
      <div className="mt-3">
        <Skeleton className="h-3 w-24" />
      </div>
    </div>
  );
}

export default function OrgDashboard() {
  const { user } = useAuth();
  // One RLS-scoped server round trip replaces the previous six unbounded table
  // downloads (see get_org_dashboard_summary()); the presentation below is unchanged.
  const { data: dashboard, isLoading: summaryLoading, isError, error, refetch } = useOrgDashboardSummary();
  // RLS scopes both of these to what the viewer can see; roles without resident access simply
  // get empty results and the banner below stays hidden.
  const { data: residentItems } = useListAllResidentComplianceItems({ status: ["expired", "missing", "due_soon"] });
  const { data: residents } = useListResidents();
  const { facilityTypes } = useVisibleFacilityTypes();
  const dailyOperations = useDailyOperationsCommandCenter();

  const summary: DashboardSummary = useMemo(() => ({
    compliantCount: dashboard?.compliance.compliantCount ?? 0,
    dueSoon30Count: dashboard?.compliance.dueSoon30Count ?? 0,
    dueSoon90Count: dashboard?.compliance.dueSoon90Count ?? 0,
    expiredCount: dashboard?.compliance.expiredCount ?? 0,
    missingDocumentCount: dashboard?.compliance.missingDocumentCount ?? 0,
    totalTrackedCount: dashboard?.compliance.totalTrackedCount ?? 0,
    compliancePercentage: dashboard?.compliance.compliancePercentage ?? 100,
    totalEmployees: dashboard?.staff.totalEmployees ?? 0,
    openAlertsCount: dashboard?.alerts.openCount ?? 0,
    totalMedAdminStaff: dashboard?.staff.totalMedAdminStaff ?? 0,
    trainersDueForRecert: dashboard?.staff.trainersDueForRecert ?? 0,
    recentUploadsCount: dashboard?.uploads.recentCount ?? 0,
    recentUploads: (dashboard?.uploads.recent ?? []).map(d => ({
      id: d.id, fileName: d.fileName, documentType: d.documentType, createdAt: d.createdAt,
    })),
    facilityCompliance: (dashboard?.facilities ?? []).map(f => ({
      facilityId: f.id, facilityName: f.name, complianceScore: f.complianceScore,
    })),
  }), [dashboard]);

  const recentAlerts = dashboard?.alerts.recent ?? [];
  const criticalAlertsCount = dashboard?.alerts.criticalCount ?? 0;
  const firstCriticalTitle = recentAlerts.find(a => a.severity === "critical")?.title
    ?? "Open the alerts page to review the details.";
  const compliancePct = summary.compliancePercentage;

  const complianceColor = compliancePct >= 90 ? "text-emerald-600" : compliancePct >= 75 ? "text-amber-600" : "text-red-600";

  const totalTracked = summary.totalTrackedCount;
  const dueSoonPct = totalTracked > 0 ? Math.round((summary.dueSoon30Count / totalTracked) * 100) : 0;
  const expiredPct = totalTracked > 0 ? Math.round((summary.expiredCount / totalTracked) * 100) : 0;

  const facilityComplianceMap = new Map(
    summary.facilityCompliance.map(fc => [fc.facilityId, fc]),
  );

  // "State forms" banner: only for roles that can act on resident forms, only for orgs with a
  // PCH/ALF facility, and only when something actually needs attention -- an all-zero banner
  // would just be noise on every other org's dashboard.
  const residentFormsSummary = useMemo(
    () =>
      summarizeResidentComplianceAnalytics(
        (residents ?? []).filter((r) => r.status === "active"),
        residentItems ?? [],
        toLocalIsoDate(),
      ),
    [residents, residentItems],
  );
  const openResidentFormsCount =
    residentFormsSummary.expiredItems + residentFormsSummary.missingItems + residentFormsSummary.dueSoonItems;
  const showResidentFormsBanner =
    ["org_admin", "facility_manager", "auditor"].includes(user?.role ?? "")
    && hasAnyFacilityType(facilityTypes, PCH_ALR_ONLY_FACILITY_TYPES)
    && openResidentFormsCount > 0;

  const recentUploads = summary.recentUploads;
  const actionPlan = buildActionPlan({
    summary,
    criticalAlertsCount,
    facilities: summary.facilityCompliance,
  });
  const benchmarkFacility = summary.facilityCompliance[0];
  const benchmarkQuery = useQuery({
    queryKey: ["facility-benchmark-comparison", benchmarkFacility?.facilityId],
    enabled: Boolean(benchmarkFacility?.facilityId && ["platform_admin","org_admin","facility_manager","auditor"].includes(user?.role ?? "")),
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_facility_benchmark_comparison", { p_facility_id: benchmarkFacility!.facilityId });
      if (error) return { available: false } as const;
      return data as { available: boolean; cohort?: { organizationCount: number; facilityCount: number; kThreshold: number; jurisdictionCode: string }; metrics?: { trainingComplianceRate?: { p25: number; p50: number; p75: number }; medianCredentialRenewalDays?: { p50: number }; incidentsPer100OccupiedBeds?: { p50: number } } };
    },
  });

  const exportActionPlan = () => {
    const rows = [
      ["Priority", "Action", "Details"],
      ...actionPlan.map((action) => [
        action.priority,
        action.title,
        action.description,
      ]),
    ];

    const escapeCsvValue = (value: unknown) => {
      const raw = String(value);
      const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
      return `"${safe.replaceAll('"', '""')}"`;
    };

    const csv = rows.map((row) => row.map(escapeCsvValue).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `caremetric-carebase-action-plan-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  if (isError) {
    return (
      <div className="space-y-8">
        <div className="page-header">
          <h1>Compliance Dashboard</h1>
          <p>Welcome back, {user?.firstName}. Here's your compliance overview.</p>
        </div>
        <QueryError what="your compliance overview" error={error} onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="page-header">
        <h1>Compliance Dashboard</h1>
        <p>Welcome back, {user?.firstName}. Here's your compliance overview.</p>
      </div>

      {["org_admin", "facility_manager"].includes(user?.role ?? "") ? (
        <div className="premium-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="text-lg font-semibold">Today</p><p className="text-sm text-muted-foreground">Operational work that needs a manager decision now.</p></div>
            <Button asChild variant="outline" size="sm"><Link href="/app/pch-alr-operations">Open full operations center</Link></Button>
          </div>
          {dailyOperations.isError ? <div className="mt-4"><QueryError what="today's operations" error={dailyOperations.error} onRetry={() => dailyOperations.refetch()} /></div> : dailyOperations.isLoading ? <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[0,1,2,3].map((item) => <Skeleton key={item} className="h-20" />)}</div> : <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Link href="/app/shift-handoffs" className="rounded-lg border p-3 hover:bg-muted"><p className="text-xs text-muted-foreground">Open handoffs</p><p className="text-2xl font-semibold">{dailyOperations.data?.dailyExecution.openHandoffItems ?? 0}</p><p className="text-xs text-destructive">{dailyOperations.data?.dailyExecution.urgentHandoffItems ?? 0} urgent</p></Link>
            <Link href="/app/workforce-operations" className="rounded-lg border p-3 hover:bg-muted"><p className="text-xs text-muted-foreground">Time-off decisions</p><p className="text-2xl font-semibold">{dailyOperations.data?.dailyExecution.pendingTimeOff ?? 0}</p><p className="text-xs text-muted-foreground">Manager queue</p></Link>
            <Link href="/app/schedule" className="rounded-lg border p-3 hover:bg-muted"><p className="text-xs text-muted-foreground">Open shift offers</p><p className="text-2xl font-semibold">{dailyOperations.data?.dailyExecution.openShiftOffers ?? 0}</p><p className="text-xs text-muted-foreground">Coverage opportunities</p></Link>
            <Link href="/app/work" className="rounded-lg border p-3 hover:bg-muted"><p className="text-xs text-muted-foreground">Unfilled shifts</p><p className="text-2xl font-semibold">{dailyOperations.data?.dailyExecution.unfilledShifts ?? 0}</p><p className="text-xs text-muted-foreground">Owned work items</p></Link>
          </div>}
        </div>
      ) : null}

      {benchmarkQuery.data?.available && benchmarkFacility ? (
        <div className="premium-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold">Your facility vs. peers</p>
              <p className="text-sm text-muted-foreground">Anonymized aggregate cohort; cohorts smaller than k={benchmarkQuery.data.cohort?.kThreshold ?? 10} are suppressed.</p>
            </div>
            <Badge variant="outline">{benchmarkQuery.data.cohort?.organizationCount} organizations / {benchmarkQuery.data.cohort?.facilityCount} facilities</Badge>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <div><p className="text-2xl font-semibold">{benchmarkFacility.complianceScore}%</p><p className="text-xs text-muted-foreground">your training compliance</p></div>
            <div><p className="text-2xl font-semibold">{Math.round(benchmarkQuery.data.metrics?.trainingComplianceRate?.p50 ?? 0)}%</p><p className="text-xs text-muted-foreground">peer median compliance</p></div>
            <div><p className="text-2xl font-semibold">{Math.round(benchmarkQuery.data.metrics?.medianCredentialRenewalDays?.p50 ?? 0)}</p><p className="text-xs text-muted-foreground">peer median renewal runway days</p></div>
            <div><p className="text-2xl font-semibold">{Number(benchmarkQuery.data.metrics?.incidentsPer100OccupiedBeds?.p50 ?? 0).toFixed(1)}</p><p className="text-xs text-muted-foreground">peer incidents per 100 occupied beds</p></div>
          </div>
        </div>
      ) : null}

      {criticalAlertsCount > 0 && (
        <div className="rounded-xl border border-red-200 bg-gradient-to-r from-red-50 to-rose-50 p-5 flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="h-10 w-10 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
            <AlertCircle className="h-5 w-5 text-red-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-red-900">
              {criticalAlertsCount} Critical Alert{criticalAlertsCount > 1 ? "s" : ""} Require Attention
            </p>
            <p className="text-sm text-red-700/80 mt-0.5">{firstCriticalTitle}</p>
          </div>
          <Link href="/app/alerts">
            <Button size="sm" className="w-full bg-red-600 text-white shadow-sm hover:bg-red-700 sm:w-auto">
              View Alerts
            </Button>
          </Link>
        </div>
      )}

      {showResidentFormsBanner && (
        <div className="rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-yellow-50 p-5 flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="h-10 w-10 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
            <FileText className="h-5 w-5 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-amber-900">
              {openResidentFormsCount} Resident State Form{openResidentFormsCount > 1 ? "s" : ""} Need{openResidentFormsCount > 1 ? "" : "s"} Attention
            </p>
            <p className="text-sm text-amber-700/80 mt-0.5">
              {residentFormsSummary.expiredItems} expired · {residentFormsSummary.missingItems} missing · {residentFormsSummary.dueSoonItems} due soon
            </p>
          </div>
          <Link href="/app/state-forms">
            <Button size="sm" variant="outline" className="w-full border-amber-300 text-amber-900 shadow-sm hover:bg-amber-100 sm:w-auto">
              Open State Forms
            </Button>
          </Link>
        </div>
      )}

      {summaryLoading ? (
        <QueryLoading what="compliance summary">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </div>
        </QueryLoading>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <div className="stat-card">
            <div className="flex items-start justify-between">
              <div>
                <StatLabel
                  label="Compliant Requirements"
                  tooltip="Training and practicum requirements (across all facilities) that currently meet Pennsylvania Chapter 2800 compliance status."
                />
                <p className="stat-value text-emerald-600">{summary.compliantCount}</p>
              </div>
              <div className="stat-icon bg-emerald-50">
                <CheckCircle className="h-5 w-5 text-emerald-600" />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
              <TrendingUp className="h-3.5 w-3.5" />
              <span>of {totalTracked} tracked requirements</span>
            </div>
          </div>

          <div className="stat-card">
            <div className="flex items-start justify-between">
              <div>
                <StatLabel
                  label="Due Within 30 Days"
                  tooltip="Training and practicum requirements with a due date in the next 30 days."
                />
                <p className="stat-value text-amber-600">{summary.dueSoon30Count}</p>
              </div>
              <div className="stat-icon bg-amber-50">
                <Clock className="h-5 w-5 text-amber-600" />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-xs text-amber-600 font-medium">
              <Activity className="h-3.5 w-3.5" />
              <span>{dueSoonPct}% of tracked requirements</span>
            </div>
          </div>

          <div className="stat-card">
            <div className="flex items-start justify-between">
              <div>
                <StatLabel
                  label="Due Within 90 Days"
                  tooltip="Training and practicum requirements with a due date in the next 90 days -- this includes the items already counted in Due Within 30 Days."
                />
                <p className="stat-value text-orange-600">{summary.dueSoon90Count}</p>
              </div>
              <div className="stat-icon bg-orange-50">
                <Clock className="h-5 w-5 text-orange-600" />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-xs text-orange-600 font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>Includes items due within 30 days</span>
            </div>
          </div>

          <div className="stat-card">
            <div className="flex items-start justify-between">
              <div>
                <StatLabel
                  label="Expired Requirements"
                  tooltip="Training and practicum requirements that are past their due date and have not been renewed."
                />
                <p className="stat-value text-red-600">{summary.expiredCount}</p>
              </div>
              <div className="stat-icon bg-red-50">
                <XCircle className="h-5 w-5 text-red-600" />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-xs text-red-600 font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>{expiredPct}% of tracked requirements</span>
            </div>
          </div>

          <div className="stat-card">
            <div className="flex items-start justify-between">
              <div>
                <StatLabel
                  label="Trainers Needing Recertification"
                  tooltip="Active staff marked as trainers who have at least one training requirement that is due soon or expired, and must recertify to keep training others."
                />
                <p className="stat-value text-purple-600">{summary.trainersDueForRecert}</p>
              </div>
              <div className="stat-icon bg-purple-50">
                <GraduationCap className="h-5 w-5 text-purple-600" />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-xs text-purple-600 font-medium">
              <Shield className="h-3.5 w-3.5" />
              <span>Active trainers due for recertification</span>
            </div>
          </div>

          <div className="stat-card">
            <div className="flex items-start justify-between">
              <div>
                <StatLabel
                  label="Recent Uploads"
                  tooltip="Training documents (certificates, rosters, and other supporting files) uploaded to the system in the last 14 days."
                />
                <p className="stat-value text-blue-600">{summary.recentUploadsCount}</p>
              </div>
              <div className="stat-icon bg-blue-50">
                <Upload className="h-5 w-5 text-blue-600" />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-xs text-blue-600 font-medium">
              <FileText className="h-3.5 w-3.5" />
              <span>Last 14 days</span>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/app/employees?action=add" className="group flex rounded-xl border border-border/60 bg-card p-4 transition-all hover:border-primary/20 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div className="flex w-full items-center gap-3 sm:flex-col sm:gap-2">
            <div className="h-10 w-10 rounded-lg bg-primary/8 flex items-center justify-center group-hover:bg-primary/12 transition-colors">
              <UserPlus className="h-5 w-5 text-primary/70" />
            </div>
            <span className="text-sm font-medium text-muted-foreground transition-colors group-hover:text-foreground sm:text-xs">Add Employee</span>
          </div>
        </Link>
        <Link href="/app/reports" className="group flex rounded-xl border border-border/60 bg-card p-4 transition-all hover:border-primary/20 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div className="flex w-full items-center gap-3 sm:flex-col sm:gap-2">
            <div className="h-10 w-10 rounded-lg bg-primary/8 flex items-center justify-center group-hover:bg-primary/12 transition-colors">
              <FileText className="h-5 w-5 text-primary/70" />
            </div>
            <span className="text-sm font-medium text-muted-foreground transition-colors group-hover:text-foreground sm:text-xs">Run Report</span>
          </div>
        </Link>
        <Link href="/app/training-matrix" className="group flex rounded-xl border border-border/60 bg-card p-4 transition-all hover:border-primary/20 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div className="flex w-full items-center gap-3 sm:flex-col sm:gap-2">
            <div className="h-10 w-10 rounded-lg bg-primary/8 flex items-center justify-center group-hover:bg-primary/12 transition-colors">
              <LayoutGrid className="h-5 w-5 text-primary/70" />
            </div>
            <span className="text-sm font-medium text-muted-foreground transition-colors group-hover:text-foreground sm:text-xs">View Matrix</span>
          </div>
        </Link>
        <Link href="/app/alerts" className="group flex rounded-xl border border-border/60 bg-card p-4 transition-all hover:border-primary/20 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div className="flex w-full items-center gap-3 sm:flex-col sm:gap-2">
            <div className="h-10 w-10 rounded-lg bg-primary/8 flex items-center justify-center group-hover:bg-primary/12 transition-colors">
              <Bell className="h-5 w-5 text-primary/70" />
            </div>
            <span className="text-sm font-medium text-muted-foreground transition-colors group-hover:text-foreground sm:text-xs">Manage Alerts</span>
          </div>
        </Link>
      </div>

      <div className="premium-card">
        <div className="p-6 border-b border-border/60 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="section-title">
              <Shield className="h-4 w-4 text-muted-foreground" />
              Priority Action Plan
            </h3>
            <p className="text-sm text-muted-foreground mt-1">Auto-prioritized next steps from alerts, deadlines, documents, and facility compliance.</p>
          </div>
          <Button variant="outline" size="sm" onClick={exportActionPlan} disabled={actionPlan.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
        <div className="p-4">
          {summaryLoading ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {[...Array(4)].map((_, index) => <Skeleton key={index} className="h-32 rounded-xl" />)}
            </div>
          ) : actionPlan.length === 0 ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center">
              <CheckCircle className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
              <p className="font-semibold text-emerald-900">No urgent actions right now</p>
              <p className="text-sm text-emerald-700/80">Compliance, alerts, and documentation are currently on track.</p>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {actionPlan.map(action => {
                const Icon = action.icon;
                const priorityClass = action.priority === "Critical"
                  ? "border-red-200 bg-red-50 text-red-700"
                  : action.priority === "High"
                    ? "border-amber-200 bg-amber-50 text-amber-700"
                    : "border-blue-200 bg-blue-50 text-blue-700";
                return (
                  <div key={action.id} className="rounded-xl border border-border/60 bg-card p-4 flex flex-col gap-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="h-10 w-10 rounded-lg bg-primary/8 flex items-center justify-center shrink-0">
                        <Icon className="h-5 w-5 text-primary/70" />
                      </div>
                      <Badge variant="outline" className={priorityClass}>{action.priority}</Badge>
                    </div>
                    <div className="space-y-1 flex-1">
                      <p className="text-sm font-semibold leading-snug">{action.title}</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">{action.description}</p>
                    </div>
                    <Button asChild variant="outline" size="sm" className="w-full">
                      <Link href={action.href}>
                        {action.label}
                        <ChevronRight className="ml-1 h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 premium-card">
          <div className="p-6 border-b border-border/60">
            <h3 className="section-title">Overall Compliance Score</h3>
          </div>
          <div className="p-6">
            <div className="flex flex-col items-center gap-6 sm:flex-row sm:gap-8">
              {summaryLoading ? (
                <Skeleton className="h-[140px] w-[140px] rounded-full" />
              ) : (
                <DonutChart percentage={compliancePct} />
              )}
              <div className="flex-1">
                <p className={`text-lg font-semibold ${complianceColor}`}>
                  {compliancePct >= 90 ? "Excellent" : compliancePct >= 75 ? "Needs Improvement" : "At Risk"}
                </p>
                <p className="text-sm text-muted-foreground mt-1">of training records compliant</p>
              </div>
            </div>
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
              <div className="rounded-lg bg-muted/50 p-3.5">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Users className="h-4 w-4" />
                  <span className="text-xs font-medium">Active Staff</span>
                </div>
                <p className="text-xl font-bold">{summary.totalEmployees}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3.5">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-xs font-medium">Open Alerts</span>
                </div>
                <p className="text-xl font-bold">{summary.openAlertsCount}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3.5">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Shield className="h-4 w-4" />
                  <span className="text-xs font-medium">Med Admin</span>
                </div>
                <p className="text-xl font-bold">{summary.totalMedAdminStaff}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 flex flex-col gap-6">
          <div className="premium-card flex flex-col flex-1">
            <div className="p-6 border-b border-border/60 flex items-center justify-between">
              <h3 className="section-title">Recent Alerts</h3>
              <Link href="/app/alerts">
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-foreground -mr-2">
                  View All <ChevronRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
            <div className="flex-1 p-4">
              <div className="space-y-2">
                {recentAlerts.map(alert => (
                  <div key={alert.id} className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors">
                    <div className={`h-2 w-2 rounded-full mt-1.5 shrink-0 ${
                      alert.severity === "critical" ? "bg-red-500" : alert.severity === "warning" ? "bg-amber-500" : "bg-blue-500"
                    }`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium leading-snug">{alert.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{alert.message}</p>
                    </div>
                    <Badge variant="outline" className={`text-[10px] shrink-0 ${
                      alert.severity === "critical" ? "border-red-200 text-red-600 bg-red-50" :
                      alert.severity === "warning" ? "border-amber-200 text-amber-600 bg-amber-50" :
                      "border-blue-200 text-blue-600 bg-blue-50"
                    }`}>
                      {alert.severity}
                    </Badge>
                  </div>
                ))}
                {recentAlerts.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <CheckCircle className="h-8 w-8 text-emerald-400 mb-2" />
                    <p className="text-sm font-medium text-muted-foreground">No open alerts</p>
                    <p className="text-xs text-muted-foreground/60">Great work keeping compliant!</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {recentUploads && recentUploads.length > 0 && (
            <div className="premium-card">
              <div className="p-5 border-b border-border/60">
                <h3 className="section-title">
                  <Upload className="h-4 w-4 text-muted-foreground" />
                  Recent Uploads
                </h3>
              </div>
              <div className="p-4">
                <div className="space-y-2">
                  {recentUploads.map(doc => (
                    <div key={doc.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50">
                      <FileText className="h-4 w-4 text-primary/60 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium truncate">{doc.fileName}</p>
                        <p className="text-xs text-muted-foreground">{new Date(doc.createdAt).toLocaleDateString()}</p>
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0">{doc.documentType}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="premium-card">
        <div className="p-6 border-b border-border/60 flex items-center justify-between">
          <h3 className="section-title">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            Facilities
          </h3>
          <Link href="/app/facilities">
            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-foreground -mr-2">
              View All <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
        <div className="divide-y divide-border/60">
          {dashboard?.facilities.slice(0, 5).map(facility => {
            const fc = facilityComplianceMap.get(facility.id);
            const score = fc?.complianceScore ?? 0;
            const dotColor = score >= 90 ? "bg-emerald-500" : score >= 75 ? "bg-amber-500" : "bg-red-500";
            const barColor = score >= 90 ? "bg-emerald-500" : score >= 75 ? "bg-amber-500" : "bg-red-500";

            return (
              <Link key={facility.id} href={`/app/facilities/${facility.id}`}>
                <div className="flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="relative">
                      <div className="h-10 w-10 rounded-lg bg-primary/8 flex items-center justify-center">
                        <Building2 className="h-5 w-5 text-primary/70" />
                      </div>
                      <div className={`absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card ${dotColor}`} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold truncate">{facility.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {facilityTypeLabel(facility.facilityType)} {facility.licenseNumber ? `· ${facility.licenseNumber}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end sm:gap-4 sm:shrink-0">
                    {fc && (
                      <div className="hidden sm:flex items-center gap-2.5">
                        <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                            style={{ width: `${score}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium text-muted-foreground w-8 text-right">{score}%</span>
                      </div>
                    )}
                    <Badge variant="outline" className={`text-[10px] font-medium ${
                      facility.isActive
                        ? "border-emerald-200 text-emerald-700 bg-emerald-50"
                        : "border-slate-200 text-slate-500 bg-slate-50"
                    }`}>
                      {facility.isActive ? "Active" : "Inactive"}
                    </Badge>
                    <ChevronRight className="h-4 w-4 text-muted-foreground/40" />
                  </div>
                </div>
              </Link>
            );
          })}
          {(dashboard?.facilities ?? []).length === 0 && (
            <div className="px-6 py-12 text-center">
              <p className="text-sm text-muted-foreground">No facilities found.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
