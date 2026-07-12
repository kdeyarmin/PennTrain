import { useMemo } from "react";
import { useListEmployees, type Employee } from "@/hooks/useEmployees";
import { useListFacilities, type Facility } from "@/hooks/useFacilities";
import { useListTrainingRecords, type TrainingRecord } from "@/hooks/useTrainingRecords";
import { useListPracticums, type Practicum } from "@/hooks/usePracticums";
import { useListAlerts, type Alert } from "@/hooks/useAlerts";
import { useListDocuments, type TrainingDocument } from "@/hooks/useDocuments";
import { useListTrainingTypes } from "@/hooks/useTrainingTypes";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Building2, Users, AlertTriangle, CheckCircle, Clock, XCircle, AlertCircle, ChevronRight, TrendingUp, Shield, Activity, UserPlus, FileText, LayoutGrid, Bell, GraduationCap, Upload, Download, Info, type LucideIcon } from "lucide-react";
import { Link } from "wouter";

// Compliance-bearing records (training records + practicums) share this status vocabulary.
// "not_applicable" and "pending_review" training records are excluded from compliance math
// entirely -- they aren't yet (or never will be) part of the compliant/non-compliant split.
const RELEVANT_STATUSES = new Set(["compliant", "due_soon", "expired", "missing"]);
const DUE_SOON_30_DAYS = 30;
const DUE_SOON_90_DAYS = 90;
const RECENT_UPLOAD_WINDOW_DAYS = 14;
const RECENT_UPLOADS_DISPLAY_LIMIT = 5;

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
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/Dashboard.tsx
=======
  totalTrackedCount: number;
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/Dashboard.tsx
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

// Days between now (UTC midnight) and a `date` column value (e.g. "2026-08-01"), or null
// if there's no due date to compare against.
function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const due = new Date(`${dateStr}T00:00:00Z`);
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((due.getTime() - todayUtc) / 86_400_000);
}

/**
 * Ports the old server-side `/api/dashboard/summary` (+ `/api/dashboard/compliance-by-facility`)
 * aggregation to the client, now that all data arrives via raw Supabase table hooks instead of a
 * pre-aggregated endpoint. Training records and practicums share the same status vocabulary
 * (compliant/due_soon/expired/missing), so both feed into the same overall + per-facility
 * compliance percentage; alerts/documents/employees are reduced separately for the remaining
 * stat-card numbers.
 */
function computeDashboardSummary({
  employees,
  facilities,
  trainingRecords,
  practicums,
  openAlerts,
  documents,
  trainerTrainingTypeIds,
}: {
  employees: Employee[];
  facilities: Facility[];
  trainingRecords: TrainingRecord[];
  practicums: Practicum[];
  openAlerts: Alert[];
  documents: TrainingDocument[];
  trainerTrainingTypeIds: Set<string>;
}): DashboardSummary {
  interface ComplianceItem {
    facilityId: string;
    status: string;
    dueDate: string | null;
  }

  const trainingItems: ComplianceItem[] = trainingRecords
    .filter(r => RELEVANT_STATUSES.has(r.status))
    .map(r => ({ facilityId: r.facility_id, status: r.status, dueDate: r.due_date }));
  const practicumItems: ComplianceItem[] = practicums
    .filter(p => RELEVANT_STATUSES.has(p.status))
    .map(p => ({ facilityId: p.facility_id, status: p.status, dueDate: p.due_date }));
  const allItems = [...trainingItems, ...practicumItems];

  let compliantCount = 0;
  let dueSoonAllCount = 0;
  let dueSoon30Count = 0;
  let dueSoon90Count = 0;
  let expiredCount = 0;
  let missingCount = 0;

  const byFacility = new Map<string, { compliant: number; relevant: number }>();
  const touchFacility = (facilityId: string, isCompliant: boolean) => {
    const bucket = byFacility.get(facilityId) ?? { compliant: 0, relevant: 0 };
    bucket.relevant += 1;
    if (isCompliant) bucket.compliant += 1;
    byFacility.set(facilityId, bucket);
  };

  for (const item of allItems) {
    switch (item.status) {
      case "compliant":
        compliantCount++;
        touchFacility(item.facilityId, true);
        break;
      case "expired":
        expiredCount++;
        touchFacility(item.facilityId, false);
        break;
      case "missing":
        missingCount++;
        touchFacility(item.facilityId, false);
        break;
      case "due_soon": {
        dueSoonAllCount++;
        touchFacility(item.facilityId, false);
        const days = daysUntil(item.dueDate);
        if (days !== null && days <= DUE_SOON_90_DAYS) dueSoon90Count++;
        if (days !== null && days <= DUE_SOON_30_DAYS) dueSoon30Count++;
        break;
      }
      default:
        break;
    }
  }

  const relevantCount = compliantCount + dueSoonAllCount + expiredCount + missingCount;
  const compliancePercentage = relevantCount > 0 ? Math.round((compliantCount / relevantCount) * 100) : 100;

  const facilityCompliance: FacilityComplianceSummary[] = facilities.map(f => {
    const bucket = byFacility.get(f.id);
    const score = bucket && bucket.relevant > 0 ? Math.round((bucket.compliant / bucket.relevant) * 100) : 100;
    return { facilityId: f.id, facilityName: f.name, complianceScore: score };
  });

  const missingDocumentCount = trainingRecords.filter(
    r => r.status === "missing" && r.document_required,
  ).length;

  const activeEmployees = employees.filter(e => e.status === "active");
  const totalEmployees = activeEmployees.length;
  const totalMedAdminStaff = activeEmployees.filter(e => e.administers_medications).length;

  // A trainer is "due for recert" when they have at least one training record, in a training
  // type flagged `applies_to_trainers`, that is due_soon or expired.
  const employeesWithTrainerTrainingDue = new Set(
    trainingRecords
      .filter(
        r =>
          (r.status === "due_soon" || r.status === "expired") &&
          trainerTrainingTypeIds.has(r.training_type_id),
      )
      .map(r => r.employee_id),
  );
  const trainersDueForRecert = activeEmployees.filter(
    e => e.trainer_status && employeesWithTrainerTrainingDue.has(e.id),
  ).length;

  const recentUploadDocs = documents.filter(d => {
    const days = daysUntil(d.created_at.slice(0, 10));
    return days !== null && days >= -RECENT_UPLOAD_WINDOW_DAYS;
  });
  const recentUploads: RecentUpload[] = recentUploadDocs
    .slice(0, RECENT_UPLOADS_DISPLAY_LIMIT)
    .map(d => ({ id: d.id, fileName: d.file_name, documentType: d.document_type, createdAt: d.created_at }));

  return {
    compliantCount,
    dueSoon30Count,
    dueSoon90Count,
    expiredCount,
    missingDocumentCount,
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/Dashboard.tsx
=======
    totalTrackedCount: relevantCount,
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/Dashboard.tsx
    compliancePercentage,
    totalEmployees,
    openAlertsCount: openAlerts.length,
    totalMedAdminStaff,
    trainersDueForRecert,
    recentUploadsCount: recentUploadDocs.length,
    recentUploads,
    facilityCompliance,
  };
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
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
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
          className="stat-label inline-flex w-fit cursor-help items-center gap-1 border-0 bg-transparent p-0 text-left"
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
  const { data: employees, isLoading: employeesLoading } = useListEmployees();
  const { data: facilities, isLoading: facilitiesLoading } = useListFacilities();
  const { data: trainingRecords, isLoading: trainingRecordsLoading } = useListTrainingRecords();
  const { data: practicums, isLoading: practicumsLoading } = useListPracticums();
  const { data: alerts, isLoading: alertsLoading } = useListAlerts({ status: "open" });
  const { data: documents, isLoading: documentsLoading } = useListDocuments();
  const { data: trainingTypes, isLoading: trainingTypesLoading } = useListTrainingTypes({ isActive: true });

  const summaryLoading =
    employeesLoading || facilitiesLoading || trainingRecordsLoading || practicumsLoading || alertsLoading || trainingTypesLoading || documentsLoading;

  const summary = useMemo(
    () =>
      computeDashboardSummary({
        employees: employees ?? [],
        facilities: facilities ?? [],
        trainingRecords: trainingRecords ?? [],
        practicums: practicums ?? [],
        openAlerts: alerts ?? [],
        documents: documents ?? [],
        trainerTrainingTypeIds: new Set(
          (trainingTypes ?? []).filter(t => t.applies_to_trainers).map(t => t.id),
        ),
      }),
    [employees, facilities, trainingRecords, practicums, alerts, documents, trainingTypes],
  );

  const criticalAlerts = alerts?.filter(a => a.severity === "critical") ?? [];
  const criticalAlertsCount = criticalAlerts.length;
  const compliancePct = summary.compliancePercentage;

  const complianceColor = compliancePct >= 90 ? "text-emerald-600" : compliancePct >= 75 ? "text-amber-600" : "text-red-600";

<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/Dashboard.tsx
  const totalRecords = summary.compliantCount + summary.dueSoon30Count + summary.expiredCount;
  const dueSoonPct = totalRecords > 0 ? Math.round((summary.dueSoon30Count / totalRecords) * 100) : 0;
  const expiredPct = totalRecords > 0 ? Math.round((summary.expiredCount / totalRecords) * 100) : 0;
=======
  const totalTracked = summary.totalTrackedCount;
  const dueSoonPct = totalTracked > 0 ? Math.round((summary.dueSoon30Count / totalTracked) * 100) : 0;
  const expiredPct = totalTracked > 0 ? Math.round((summary.expiredCount / totalTracked) * 100) : 0;
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/Dashboard.tsx

  const facilityComplianceMap = new Map(
    summary.facilityCompliance.map(fc => [fc.facilityId, fc]),
  );

  const recentUploads = summary.recentUploads;
  const actionPlan = buildActionPlan({
    summary,
    criticalAlertsCount,
    facilities: summary.facilityCompliance,
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
    link.download = `caremetric-train-action-plan-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div className="space-y-8">
      <div className="page-header">
        <h1>Compliance Dashboard</h1>
        <p>Welcome back, {user?.firstName}. Here's your compliance overview.</p>
      </div>

      {criticalAlerts.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-gradient-to-r from-red-50 to-rose-50 p-5 flex items-start gap-4">
          <div className="h-10 w-10 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
            <AlertCircle className="h-5 w-5 text-red-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-red-900">
              {criticalAlerts.length} Critical Alert{criticalAlerts.length > 1 ? "s" : ""} Require Attention
            </p>
            <p className="text-sm text-red-700/80 mt-0.5">{criticalAlerts[0]?.title}</p>
          </div>
          <Link href="/app/alerts">
            <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white shadow-sm">
              View Alerts
            </Button>
          </Link>
        </div>
      )}

      {summaryLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <div className="stat-card">
            <div className="flex items-start justify-between">
              <div>
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/Dashboard.tsx
                <p className="stat-label">Compliant</p>
=======
                <StatLabel
                  label="Compliant Requirements"
                  tooltip="Training and practicum requirements (across all facilities) that currently meet Pennsylvania Chapter 2800 compliance status."
                />
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/Dashboard.tsx
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
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/Dashboard.tsx
                <p className="stat-label">Due ≤30 Days</p>
=======
                <StatLabel
                  label="Due Within 30 Days"
                  tooltip="Training and practicum requirements with a due date in the next 30 days."
                />
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/Dashboard.tsx
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
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/Dashboard.tsx
                <p className="stat-label">Due ≤90 Days</p>
=======
                <StatLabel
                  label="Due Within 90 Days"
                  tooltip="Training and practicum requirements with a due date in the next 90 days -- this includes the items already counted in Due Within 30 Days."
                />
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/Dashboard.tsx
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
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/Dashboard.tsx
                <p className="stat-label">Expired</p>
=======
                <StatLabel
                  label="Expired Requirements"
                  tooltip="Training and practicum requirements that are past their due date and have not been renewed."
                />
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/Dashboard.tsx
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
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/Dashboard.tsx
                <p className="stat-label">Trainers Due</p>
=======
                <StatLabel
                  label="Trainers Needing Recert"
                  tooltip="Active staff marked as trainers who have at least one training requirement that is due soon or expired, and must recertify to keep training others."
                />
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/Dashboard.tsx
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
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/Dashboard.tsx
                <p className="stat-label">Recent Uploads</p>
=======
                <StatLabel
                  label="Recent Uploads"
                  tooltip="Training documents (certificates, rosters, and other supporting files) uploaded to the system in the last 14 days."
                />
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/Dashboard.tsx
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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Link href="/app/employees?action=add">
          <div className="rounded-xl border border-border/60 bg-card p-4 flex flex-col items-center gap-2 hover:bg-muted/50 hover:border-primary/20 transition-all cursor-pointer group">
            <div className="h-10 w-10 rounded-lg bg-primary/8 flex items-center justify-center group-hover:bg-primary/12 transition-colors">
              <UserPlus className="h-5 w-5 text-primary/70" />
            </div>
            <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">Add Employee</span>
          </div>
        </Link>
        <Link href="/app/reports">
          <div className="rounded-xl border border-border/60 bg-card p-4 flex flex-col items-center gap-2 hover:bg-muted/50 hover:border-primary/20 transition-all cursor-pointer group">
            <div className="h-10 w-10 rounded-lg bg-primary/8 flex items-center justify-center group-hover:bg-primary/12 transition-colors">
              <FileText className="h-5 w-5 text-primary/70" />
            </div>
            <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">Run Report</span>
          </div>
        </Link>
        <Link href="/app/training-matrix">
          <div className="rounded-xl border border-border/60 bg-card p-4 flex flex-col items-center gap-2 hover:bg-muted/50 hover:border-primary/20 transition-all cursor-pointer group">
            <div className="h-10 w-10 rounded-lg bg-primary/8 flex items-center justify-center group-hover:bg-primary/12 transition-colors">
              <LayoutGrid className="h-5 w-5 text-primary/70" />
            </div>
            <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">View Matrix</span>
          </div>
        </Link>
        <Link href="/app/alerts">
          <div className="rounded-xl border border-border/60 bg-card p-4 flex flex-col items-center gap-2 hover:bg-muted/50 hover:border-primary/20 transition-all cursor-pointer group">
            <div className="h-10 w-10 rounded-lg bg-primary/8 flex items-center justify-center group-hover:bg-primary/12 transition-colors">
              <Bell className="h-5 w-5 text-primary/70" />
            </div>
            <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">Manage Alerts</span>
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
            <div className="flex items-center gap-8">
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
            <div className="grid grid-cols-3 gap-4 mt-6">
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
                {alerts?.slice(0, 4).map(alert => (
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
                {(!alerts || alerts.length === 0) && (
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
          {facilities?.slice(0, 5).map(facility => {
            const fc = facilityComplianceMap.get(facility.id);
            const score = fc?.complianceScore ?? 0;
            const dotColor = score >= 90 ? "bg-emerald-500" : score >= 75 ? "bg-amber-500" : "bg-red-500";
            const barColor = score >= 90 ? "bg-emerald-500" : score >= 75 ? "bg-amber-500" : "bg-red-500";

            return (
              <Link key={facility.id} href={`/app/facilities/${facility.id}`}>
                <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-4 hover:bg-muted/40 transition-colors cursor-pointer">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="relative">
                      <div className="h-10 w-10 rounded-lg bg-primary/8 flex items-center justify-center">
                        <Building2 className="h-5 w-5 text-primary/70" />
                      </div>
                      <div className={`absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card ${dotColor}`} />
                    </div>
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/Dashboard.tsx
                    <div>
                      <p className="text-[13px] font-semibold">{facility.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
=======
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold truncate">{facility.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/Dashboard.tsx
                        {facility.facility_type} {facility.license_number ? `· ${facility.license_number}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
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
                      facility.is_active
                        ? "border-emerald-200 text-emerald-700 bg-emerald-50"
                        : "border-slate-200 text-slate-500 bg-slate-50"
                    }`}>
                      {facility.is_active ? "Active" : "Inactive"}
                    </Badge>
                    <ChevronRight className="h-4 w-4 text-muted-foreground/40" />
                  </div>
                </div>
              </Link>
            );
          })}
          {(!facilities || facilities.length === 0) && (
            <div className="px-6 py-12 text-center">
              <p className="text-sm text-muted-foreground">No facilities found.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
