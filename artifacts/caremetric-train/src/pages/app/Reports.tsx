import { useCallback, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useListFacilities, type Facility } from "@/hooks/useFacilities";
import { useListEmployees, type Employee } from "@/hooks/useEmployees";
import { useListTrainingTypes, type TrainingType } from "@/hooks/useTrainingTypes";
import { useListTrainingRecords, type TrainingRecord } from "@/hooks/useTrainingRecords";
import { useListPracticums, type Practicum } from "@/hooks/usePracticums";
import { useListAlerts, type Alert } from "@/hooks/useAlerts";
import { useListDocuments, type TrainingDocument } from "@/hooks/useDocuments";
import { useListTrainingHourBuckets } from "@/hooks/useTrainingHourBuckets";
import { useListEmployeeCredentials, type EmployeeCredential } from "@/hooks/useEmployeeCredentials";
import { useListIncidents, type Incident, useListAllIncidentNotificationsDetailed, type IncidentNotification } from "@/hooks/useIncidents";
import { useListInspectionItems, type InspectionItem } from "@/hooks/useInspectionItems";
import { useListOrganizations, type Organization } from "@/hooks/useOrganizations";
import { useListProfiles, type Profile } from "@/hooks/useProfiles";
import type { Tables } from "@/lib/database.types";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { ReportViewer } from "@/components/reports/ReportViewer";
import type { LucideIcon } from "lucide-react";
import {
  FileText,
  Users,
  Building2,
  Clock,
  AlertTriangle,
  GraduationCap,
  Files,
  CheckCircle,
  Download,
  Shield,
  BookOpen,
  BarChart3,
  Calendar,
  Search,
  Grid3X3,
  Eye,
  Loader2,
  Bell,
} from "lucide-react";

interface ReportDef {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  category: string;
  requiredBy: string;
  roles?: string[];
  requiresEmployee?: boolean;
}

const ALL_REPORTS: ReportDef[] = [
  {
    id: "compliance-summary",
    title: "Compliance Summary",
    description:
      "Overview of total, compliant, expired, and due-soon training records with compliance percentages.",
    icon: BarChart3,
    category: "Compliance",
    requiredBy: "55 Pa. Code §2600",
  },
  {
    id: "facility-compliance",
    title: "Facility Compliance Scores",
    description:
      "Compare compliance scores across all facilities in your organization.",
    icon: Building2,
    category: "Compliance",
    requiredBy: "Survey Preparation",
  },
  {
    id: "survey-readiness",
    title: "Survey Readiness Assessment",
    description:
      "Comprehensive readiness checklist for state DHS survey inspections.",
    icon: Shield,
    category: "Compliance",
    requiredBy: "DHS Survey Preparation",
  },
  {
    id: "expired-training",
    title: "Expired Training Records",
    description:
      "All training records past their expiration date requiring renewal.",
    icon: AlertTriangle,
    category: "Training",
    requiredBy: "Internal Compliance",
  },
  {
    id: "due-soon",
    title: "Training Due Soon",
    description:
      "Training records expiring in the next 90 days for proactive scheduling.",
    icon: Calendar,
    category: "Training",
    requiredBy: "Internal Compliance",
  },
  {
    id: "medication-administration",
    title: "Medication Administration Training",
    description:
      "Track initial and recertification training for all medication-administering staff.",
    icon: FileText,
    category: "Training",
    requiredBy: "55 Pa. Code §2600.77",
  },
  {
    id: "training-matrix",
    title: "Training Matrix",
    description:
      "Cross-reference matrix showing each employee's status across all required training types.",
    icon: Grid3X3,
    category: "Training",
    requiredBy: "55 Pa. Code §2600.77",
  },
  {
    id: "practicum-status",
    title: "Practicum Status",
    description:
      "Completion status of required annual medication administration practicums.",
    icon: CheckCircle,
    category: "Practicum",
    requiredBy: "55 Pa. Code §2600.78",
  },
  {
    id: "annual-practicum",
    title: "Annual Practicum Report",
    description:
      "Detailed view of annual practicum records including MAR review and direct observation.",
    icon: CheckCircle,
    category: "Practicum",
    requiredBy: "55 Pa. Code §2600.78",
  },
  {
    id: "annual-hours",
    title: "Annual Training Hours",
    description:
      "Annual training hour requirements across every licensed setting, from 12-hour PCH and NH/HHA/HOS aide in-services up to 24-hour group home direct-service-worker training, with completion tracking.",
    icon: Clock,
    category: "Hours",
    requiredBy: "55 Pa. Code §2600.64",
  },
  {
    id: "training-hours",
    title: "Training Hours Detail",
    description:
      "Detailed training hours breakdown by employee and training year.",
    icon: Clock,
    category: "Hours",
    requiredBy: "55 Pa. Code §2600.64",
  },
  {
    id: "trainer-certification",
    title: "Trainer Certification Status",
    description:
      "Track initial and recertification status for all designated trainers.",
    icon: GraduationCap,
    category: "Staff",
    requiredBy: "55 Pa. Code §2600.77(g)",
  },
  {
    id: "new-employee-training",
    title: "New Employee Training",
    description:
      "Training completion for recently hired staff within their first 90 days.",
    icon: Users,
    category: "Staff",
    requiredBy: "55 Pa. Code §2600.77",
  },
  {
    id: "employee-transcript",
    title: "Employee Transcript",
    description:
      "Complete training transcript for an individual employee showing all training history.",
    icon: BookOpen,
    category: "Staff",
    requiredBy: "Record Keeping",
    requiresEmployee: true,
  },
  {
    id: "expiring-certifications",
    title: "Expiring Certifications",
    description:
      "All certifications expiring within the next 90 days across the organization.",
    icon: AlertTriangle,
    category: "Training",
    requiredBy: "Internal Compliance",
  },
  {
    id: "missing-documents",
    title: "Missing Documents",
    description:
      "Training records missing required supporting documentation.",
    icon: Files,
    category: "Documents",
    requiredBy: "Record Keeping",
  },
  {
    id: "document-audit",
    title: "Document Audit",
    description:
      "Identify training records requiring documentation and track uploaded files.",
    icon: Files,
    category: "Documents",
    requiredBy: "Record Keeping",
  },
  {
    id: "overdue-training",
    title: "Overdue Training",
    description:
      "All expired or overdue training requirements across the organization.",
    icon: AlertTriangle,
    category: "Training",
    requiredBy: "Internal Compliance",
  },
  {
    id: "credential-status",
    title: "Credential & Clearance Status",
    description:
      "Background clearances, licensure, and health screenings across all staff, with expiration status.",
    icon: Shield,
    category: "Credentials",
    requiredBy: "OAPSA / PA Board of Nursing",
  },
  {
    id: "incident-log",
    title: "Incident Log",
    description:
      "All reported incidents with severity, status, and outstanding notification deadlines.",
    icon: AlertTriangle,
    category: "Incidents",
    requiredBy: "55 Pa. Code §2600.16 / §2800.16",
  },
  {
    id: "incident-notification-register",
    title: "Incident Notification Register",
    description:
      "Every required external notification (state hotline, law enforcement, etc.) with due time, completion time, channel, recipient, and confirmation number -- the reconciliation register a surveyor diffs against the regional office's own log.",
    icon: Bell,
    category: "Incidents",
    requiredBy: "55 Pa. Code §2600.16 / §2800.16",
  },
  {
    id: "inspection-compliance",
    title: "Inspection & Equipment Compliance",
    description:
      "Fire drills, life-safety equipment, and emergency-preparedness items with next-due dates.",
    icon: FileText,
    category: "Inspections",
    requiredBy: "NFPA / CMS Emergency Preparedness Rule",
  },
];

const CATEGORIES = [
  "All",
  "Compliance",
  "Training",
  "Practicum",
  "Hours",
  "Staff",
  "Documents",
  "Credentials",
  "Incidents",
  "Inspections",
];

type SummaryCard = {
  label: string;
  value: string | number;
  variant?: "default" | "success" | "warning" | "danger";
};

interface ParsedReport {
  headers: string[];
  rows: string[][];
  summaryCards: SummaryCard[];
}

type HourBucket = Tables<"employee_training_hour_buckets">;

const DAY_MS = 24 * 60 * 60 * 1000;

// Mirrors Dashboard.tsx's RELEVANT_STATUSES: training records with status "not_applicable"
// or "pending_review" are excluded from compliance percentages and compliant/due_soon/
// expired/missing classifications entirely, so Reports.tsx and Dashboard.tsx agree on the
// same underlying data.
const RELEVANT_STATUSES = new Set(["compliant", "due_soon", "expired", "missing"]);

function relevantRecords(records: TrainingRecord[]): TrainingRecord[] {
  return records.filter((r) => RELEVANT_STATUSES.has(r.status));
}

function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 100;
}

function complianceVariant(value: number): SummaryCard["variant"] {
  return value >= 80 ? "success" : value >= 50 ? "warning" : "danger";
}

function byFacility<T extends { facility_id: string | null }>(items: T[], facilityId: string): T[] {
  return facilityId === "all" ? items : items.filter((i) => i.facility_id === facilityId);
}

const BUCKET_TYPE_LABELS: Record<string, string> = {
  general_annual: "General Annual",
  alr_dementia: "ALF Dementia (§2800.69)",
  sdcu_dementia: "Secured Dementia Unit (§2600.236)",
};

function formatBucketType(bucketType: string): string {
  return BUCKET_TYPE_LABELS[bucketType] ?? bucketType;
}

// Returns true when `dateStr` falls within the optional [from, to] range (inclusive of the
// entire `to` day). When both bounds are empty the filter is inactive and everything passes.
// When the filter is active but a row has no date value to compare, the row is excluded.
function inDateRange(dateStr: string | null | undefined, from?: string, to?: string): boolean {
  if (!from && !to) return true;
  if (!dateStr) return false;
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return false;
  if (from && t < new Date(from).getTime()) return false;
  if (to && t >= new Date(to).getTime() + DAY_MS) return false;
  return true;
}

const TRAINING_RECORD_HEADERS = ["Employee", "Job Title", "Training Type", "Completion Date", "Due Date", "Status"];

function trainingRecordRows(
  records: TrainingRecord[],
  employeeById: Map<string, Employee>,
  trainingTypeById: Map<string, TrainingType>
): string[][] {
  return records.map((r) => {
    const e = employeeById.get(r.employee_id);
    return [
      e ? `${e.first_name} ${e.last_name}` : r.employee_id,
      e?.job_title ?? "",
      trainingTypeById.get(r.training_type_id)?.name ?? "",
      r.completion_date ?? "",
      r.due_date ?? "",
      r.status,
    ];
  });
}

interface ReportContext {
  facilityId: string;
  employeeIdOverride?: string;
  dateFrom?: string;
  dateTo?: string;
  facilities: Facility[];
  employees: Employee[];
  trainingTypes: TrainingType[];
  trainingRecords: TrainingRecord[];
  practicums: Practicum[];
  documents: TrainingDocument[];
  alerts: Alert[];
  organizations: Organization[];
  profiles: Profile[];
  hourBuckets: HourBucket[];
  credentials: EmployeeCredential[];
  incidents: Incident[];
  incidentNotifications: IncidentNotification[];
  inspectionItems: InspectionItem[];
}

function buildReport(reportId: string, ctx: ReportContext): ParsedReport {
  const summaryCards: SummaryCard[] = [];

  const scopedEmployees = byFacility(ctx.employees, ctx.facilityId).filter((e) => e.status === "active");
  const scopedRecords = byFacility(ctx.trainingRecords, ctx.facilityId);
  const scopedPracticums = byFacility(ctx.practicums, ctx.facilityId);
  const scopedDocuments = byFacility(ctx.documents, ctx.facilityId);

  const employeeById = new Map(ctx.employees.map((e) => [e.id, e]));
  const trainingTypeById = new Map(ctx.trainingTypes.map((t) => [t.id, t]));
  const profileById = new Map(ctx.profiles.map((p) => [p.id, p]));

  if (reportId === "compliance-summary") {
    const rangedRecords = scopedRecords.filter((r) => inDateRange(r.due_date, ctx.dateFrom, ctx.dateTo));
    const total = relevantRecords(rangedRecords).length;
    const compliantCount = rangedRecords.filter((r) => r.status === "compliant").length;
    const expiredCount = rangedRecords.filter((r) => r.status === "expired").length;
    const dueSoonCount = rangedRecords.filter((r) => r.status === "due_soon").length;
    const compliancePct = pct(compliantCount, total);
    summaryCards.push(
      { label: "Total Employees", value: scopedEmployees.length, variant: "default" },
      { label: "Compliant", value: compliantCount, variant: "success" },
      { label: "Expired", value: expiredCount, variant: expiredCount > 0 ? "danger" : "success" },
      { label: "Compliance", value: `${compliancePct}%`, variant: complianceVariant(compliancePct) }
    );
    return {
      headers: ["Metric", "Value"],
      rows: [
        ["Total Employees", String(scopedEmployees.length)],
        ["Total Training Records", String(total)],
        ["Compliant Records", String(compliantCount)],
        ["Expired Records", String(expiredCount)],
        ["Due Soon Records", String(dueSoonCount)],
        ["Compliance Percentage", `${compliancePct}%`],
      ],
      summaryCards,
    };
  }

  if (reportId === "facility-compliance") {
    const facilityList =
      ctx.facilityId === "all" ? ctx.facilities : ctx.facilities.filter((f) => f.id === ctx.facilityId);
    const scored = facilityList.map((f) => {
      const records = ctx.trainingRecords.filter(
        (r) => r.facility_id === f.id && inDateRange(r.due_date, ctx.dateFrom, ctx.dateTo)
      );
      const relevant = relevantRecords(records);
      const compliantCount = records.filter((r) => r.status === "compliant").length;
      const expiredCount = records.filter((r) => r.status === "expired").length;
      const dueSoonCount = records.filter((r) => r.status === "due_soon").length;
      return {
        facility: f,
        total: relevant.length,
        compliantCount,
        expiredCount,
        dueSoonCount,
        score: pct(compliantCount, relevant.length),
      };
    });
    return {
      headers: ["Facility", "Type", "Total Records", "Compliant", "Expired", "Due Soon", "Compliance %"],
      rows: scored.map((s) => [
        s.facility.name,
        s.facility.facility_type.replace(/_/g, " "),
        String(s.total),
        String(s.compliantCount),
        String(s.expiredCount),
        String(s.dueSoonCount),
        `${s.score}%`,
      ]),
      summaryCards: [
        { label: "Facilities", value: scored.length },
        {
          label: "Avg Score",
          value: scored.length > 0 ? `${Math.round(scored.reduce((a, s) => a + s.score, 0) / scored.length)}%` : "—",
          variant: "default",
        },
      ],
    };
  }

  if (reportId === "survey-readiness") {
    const rangedRecords = scopedRecords.filter((r) => inDateRange(r.due_date, ctx.dateFrom, ctx.dateTo));
    const rangedPracticums = scopedPracticums.filter((p) => inDateRange(p.due_date, ctx.dateFrom, ctx.dateTo));

    const total = relevantRecords(rangedRecords).length;
    const compliantCount = rangedRecords.filter((r) => r.status === "compliant").length;
    const expiredCount = rangedRecords.filter((r) => r.status === "expired").length;
    const overallComplianceScore = pct(compliantCount, total);

    const medAdminStaff = scopedEmployees.filter((e) => e.administers_medications);
    const trainerStaff = scopedEmployees.filter((e) => e.trainer_status);
    const medAdminIds = new Set(medAdminStaff.map((e) => e.id));
    const trainerIds = new Set(trainerStaff.map((e) => e.id));

    const medAdminTypeIds = new Set(
      ctx.trainingTypes.filter((t) => t.is_active && t.applies_to_administers_meds).map((t) => t.id)
    );
    const trainerTypeIds = new Set(
      ctx.trainingTypes.filter((t) => t.is_active && t.applies_to_trainers).map((t) => t.id)
    );

    const medAdminBadRecords = rangedRecords.filter(
      (r) => medAdminIds.has(r.employee_id) && medAdminTypeIds.has(r.training_type_id) && (r.status === "expired" || r.status === "missing")
    );
    const trainerBadRecords = rangedRecords.filter(
      (r) => trainerIds.has(r.employee_id) && trainerTypeIds.has(r.training_type_id) && (r.status === "expired" || r.status === "missing")
    );

    const currentYear = new Date().getFullYear();
    const yearPracticums = rangedPracticums.filter((p) => p.practicum_year === currentYear);
    const pendingPracticums = yearPracticums.filter((p) => p.status !== "compliant");

    const missingDocsRecords = rangedRecords.filter((r) => r.status === "missing" && r.document_required);

    const criticalAlerts = byFacility(ctx.alerts, ctx.facilityId).filter((a) => a.severity === "critical");

    const checks: { check: string; status: string; detail: string }[] = [
      {
        check: "Overall Training Compliance",
        status: overallComplianceScore >= 90 ? "pass" : overallComplianceScore >= 75 ? "warning" : "fail",
        detail: `${compliantCount} of ${total} records compliant (${overallComplianceScore}%)`,
      },
      {
        check: "Expired Training Records",
        status: expiredCount === 0 ? "pass" : "fail",
        detail: `${expiredCount} expired record(s) require immediate renewal`,
      },
      {
        check: "Medication Administration Training",
        status: medAdminBadRecords.length === 0 ? "pass" : "fail",
        detail: `${medAdminBadRecords.length} of ${medAdminStaff.length} med admin staff have expired or missing training`,
      },
      {
        check: "Trainer Certification",
        status: trainerBadRecords.length === 0 ? "pass" : "fail",
        detail: `${trainerBadRecords.length} of ${trainerStaff.length} designated trainers have expired or missing certification`,
      },
      {
        check: "Annual Practicum Completion",
        status: pendingPracticums.length === 0 ? "pass" : "warning",
        detail: `${pendingPracticums.length} of ${yearPracticums.length} ${currentYear} practicums pending`,
      },
      {
        check: "Required Documentation",
        status: missingDocsRecords.length === 0 ? "pass" : "warning",
        detail: `${missingDocsRecords.length} record(s) missing required documentation`,
      },
      {
        check: "Open Critical Alerts",
        status: criticalAlerts.length === 0 ? "pass" : "fail",
        detail: `${criticalAlerts.length} open critical alert(s)`,
      },
    ];

    const passCount = checks.filter((c) => c.status === "pass").length;
    const surveyReadinessScore = pct(passCount, checks.length);

    summaryCards.push(
      { label: "Readiness Score", value: `${surveyReadinessScore}%`, variant: complianceVariant(surveyReadinessScore) },
      { label: "Compliance Score", value: `${overallComplianceScore}%`, variant: complianceVariant(overallComplianceScore) },
      { label: "Active Staff", value: scopedEmployees.length },
      { label: "Med Admin Staff", value: medAdminStaff.length }
    );

    return {
      headers: ["Check", "Status", "Detail"],
      rows: checks.map((c) => [c.check, c.status, c.detail]),
      summaryCards,
    };
  }

  if (reportId === "expired-training") {
    const records = scopedRecords.filter((r) => r.status === "expired" && inDateRange(r.due_date, ctx.dateFrom, ctx.dateTo));
    summaryCards.push({ label: "Expired Records", value: records.length, variant: records.length > 0 ? "danger" : "success" });
    return { headers: TRAINING_RECORD_HEADERS, rows: trainingRecordRows(records, employeeById, trainingTypeById), summaryCards };
  }

  if (reportId === "due-soon") {
    const records = scopedRecords.filter((r) => r.status === "due_soon" && inDateRange(r.due_date, ctx.dateFrom, ctx.dateTo));
    summaryCards.push({ label: "Due Soon Records", value: records.length, variant: records.length > 0 ? "warning" : "success" });
    return { headers: TRAINING_RECORD_HEADERS, rows: trainingRecordRows(records, employeeById, trainingTypeById), summaryCards };
  }

  if (reportId === "medication-administration") {
    const medAdminEmployees = scopedEmployees.filter((e) => e.administers_medications);
    const medAdminIds = new Set(medAdminEmployees.map((e) => e.id));
    const medAdminTypeIds = new Set(
      ctx.trainingTypes.filter((t) => t.is_active && t.applies_to_administers_meds).map((t) => t.id)
    );
    const records = scopedRecords.filter(
      (r) => medAdminIds.has(r.employee_id) && medAdminTypeIds.has(r.training_type_id) && inDateRange(r.due_date, ctx.dateFrom, ctx.dateTo)
    );
    summaryCards.push(
      { label: "Med Admin Staff", value: medAdminEmployees.length },
      { label: "Training Records", value: records.length }
    );
    return {
      headers: ["Employee", "Job Title", "Hire Date", "Training Type", "Completion", "Due Date", "Status"],
      rows: records.map((r) => {
        const e = employeeById.get(r.employee_id);
        return [
          e ? `${e.first_name} ${e.last_name}` : r.employee_id,
          e?.job_title ?? "",
          e?.hire_date ?? "",
          trainingTypeById.get(r.training_type_id)?.name ?? "",
          r.completion_date ?? "",
          r.due_date ?? "",
          r.status,
        ];
      }),
      summaryCards,
    };
  }

  if (reportId === "training-matrix") {
    const matrixTypes = ctx.trainingTypes.filter((t) => t.is_active);
    if (scopedEmployees.length === 0 || matrixTypes.length === 0) return { headers: [], rows: [], summaryCards: [] };

    const facilityTypeById = new Map(ctx.facilities.map((f) => [f.id, f.facility_type]));
    const appliesToEmployee = (t: TrainingType, e: Employee): boolean =>
      t.applies_to_facility_type === "BOTH" ||
      t.applies_to_facility_type === (e.facility_id ? facilityTypeById.get(e.facility_id) : undefined);

    const recordsByKey = new Map<string, TrainingRecord[]>();
    for (const r of scopedRecords) {
      const key = `${r.employee_id}:${r.training_type_id}`;
      const arr = recordsByKey.get(key);
      if (arr) arr.push(r);
      else recordsByKey.set(key, [r]);
    }
    const latestStatus = (employeeId: string, typeId: string): string => {
      const arr = recordsByKey.get(`${employeeId}:${typeId}`);
      if (!arr || arr.length === 0) return "no_record";
      const sorted = [...arr].sort((a, b) => {
        const da = a.due_date ? new Date(a.due_date).getTime() : 0;
        const db = b.due_date ? new Date(b.due_date).getTime() : 0;
        return db - da;
      });
      return sorted[0].status;
    };
    // A training type not scoped to this employee's facility type shouldn't be reported as a
    // missing requirement -- only recast the synthetic "no_record" placeholder; a real record
    // (e.g. a manually-tracked one) always wins regardless of scope.
    const cellStatus = (e: Employee, t: TrainingType): string => {
      const status = latestStatus(e.id, t.id);
      return status === "no_record" && !appliesToEmployee(t, e) ? "not_applicable" : status;
    };

    return {
      headers: ["Employee", "Job Title", ...matrixTypes.map((t) => t.name)],
      rows: scopedEmployees.map((e) => [
        `${e.first_name} ${e.last_name}`,
        e.job_title ?? "",
        ...matrixTypes.map((t) => cellStatus(e, t)),
      ]),
      summaryCards: [
        { label: "Employees", value: scopedEmployees.length },
        { label: "Training Types", value: matrixTypes.length },
      ],
    };
  }

  if (reportId === "practicum-status") {
    const rangedPracticums = scopedPracticums.filter((p) => inDateRange(p.due_date, ctx.dateFrom, ctx.dateTo));
    const medAdminEmployees = scopedEmployees.filter((e) => e.administers_medications);
    const compliantCount = rangedPracticums.filter((p) => p.status === "compliant").length;
    const pendingCount = rangedPracticums.length - compliantCount;
    summaryCards.push(
      { label: "Med Admin Staff", value: medAdminEmployees.length },
      { label: "Compliant", value: compliantCount, variant: "success" },
      { label: "Pending", value: pendingCount, variant: pendingCount > 0 ? "warning" : "success" }
    );
    return {
      headers: ["Employee", "Year", "Status", "Completion Date"],
      rows: rangedPracticums.map((p) => {
        const e = employeeById.get(p.employee_id);
        return [e ? `${e.first_name} ${e.last_name}` : p.employee_id, String(p.practicum_year), p.status, p.completion_date ?? ""];
      }),
      summaryCards,
    };
  }

  if (reportId === "annual-practicum") {
    const rangedPracticums = scopedPracticums.filter((p) => inDateRange(p.due_date, ctx.dateFrom, ctx.dateTo));
    const completed = rangedPracticums.filter((p) => p.status === "compliant").length;
    const pending = rangedPracticums.length - completed;
    summaryCards.push(
      { label: "Total Required", value: rangedPracticums.length },
      { label: "Completed", value: completed, variant: "success" },
      { label: "Pending", value: pending, variant: pending > 0 ? "warning" : "success" }
    );
    return {
      headers: ["Employee", "Year", "Status", "Completion Date", "Observed By", "MAR Review", "Direct Observation"],
      rows: rangedPracticums.map((p) => {
        const e = employeeById.get(p.employee_id);
        return [
          e ? `${e.first_name} ${e.last_name}` : p.employee_id,
          String(p.practicum_year),
          p.status,
          p.completion_date ?? "",
          p.observed_by ?? "",
          p.mar_review_completed ? "Yes" : "No",
          p.direct_observation_completed ? "Yes" : "No",
        ];
      }),
      summaryCards,
    };
  }

  if (reportId === "annual-hours" || reportId === "training-hours") {
    const scopedBuckets = byFacility(ctx.hourBuckets, ctx.facilityId);
    const currentYear = new Date().getFullYear();
    const fromYear = ctx.dateFrom ? new Date(ctx.dateFrom).getFullYear() : undefined;
    const toYear = ctx.dateTo ? new Date(ctx.dateTo).getFullYear() : undefined;
    const buckets = scopedBuckets.filter((b) => {
      if (fromYear !== undefined && b.training_year < fromYear) return false;
      if (toYear !== undefined && b.training_year > toYear) return false;
      if (fromYear === undefined && toYear === undefined && reportId === "annual-hours") return b.training_year === currentYear;
      return true;
    });
    const compliantCount = buckets.filter((b) => b.status === "compliant").length;
    const incompleteCount = buckets.length - compliantCount;
    const staffTracked = new Set(buckets.map((b) => b.employee_id)).size;
    summaryCards.push(
      { label: "Staff Tracked", value: staffTracked },
      { label: "Compliant Buckets", value: compliantCount, variant: "success" },
      { label: "Incomplete Buckets", value: incompleteCount, variant: incompleteCount > 0 ? "warning" : "success" }
    );
    return {
      headers: ["Employee", "Bucket", "Year", "Required Hours", "Completed Hours", "Remaining", "Status"],
      rows: buckets.map((b) => {
        const e = employeeById.get(b.employee_id);
        const req = Number(b.required_hours ?? 0);
        const comp = Number(b.completed_hours ?? 0);
        return [
          e ? `${e.first_name} ${e.last_name}` : b.employee_id,
          formatBucketType(b.bucket_type),
          String(b.training_year),
          String(req),
          String(comp),
          String(Math.max(0, req - comp)),
          b.status,
        ];
      }),
      summaryCards,
    };
  }

  if (reportId === "trainer-certification") {
    const trainers = scopedEmployees.filter((e) => e.trainer_status);
    const trainerIds = new Set(trainers.map((e) => e.id));
    const trainerTypeIds = new Set(
      ctx.trainingTypes.filter((t) => t.is_active && t.applies_to_trainers).map((t) => t.id)
    );
    const records = scopedRecords.filter(
      (r) => trainerIds.has(r.employee_id) && trainerTypeIds.has(r.training_type_id) && inDateRange(r.due_date, ctx.dateFrom, ctx.dateTo)
    );
    summaryCards.push(
      { label: "Trainers", value: trainers.length },
      { label: "Training Records", value: records.length }
    );
    return {
      headers: ["Employee", "Job Title", "Training Type", "Completion", "Due Date", "Status"],
      rows: records.map((r) => {
        const e = employeeById.get(r.employee_id);
        return [
          e ? `${e.first_name} ${e.last_name}` : r.employee_id,
          e?.job_title ?? "",
          trainingTypeById.get(r.training_type_id)?.name ?? "",
          r.completion_date ?? "",
          r.due_date ?? "",
          r.status,
        ];
      }),
      summaryCards,
    };
  }

  if (reportId === "new-employee-training") {
    const cutoff = new Date(Date.now() - 90 * DAY_MS);
    const newHires = scopedEmployees.filter((e) => e.hire_date && new Date(e.hire_date) >= cutoff);
    const newHireIds = new Set(newHires.map((e) => e.id));
    const records = scopedRecords.filter((r) => newHireIds.has(r.employee_id) && inDateRange(r.due_date, ctx.dateFrom, ctx.dateTo));
    summaryCards.push(
      { label: "New Employees", value: newHires.length },
      { label: "Training Records", value: records.length }
    );
    return {
      headers: ["Employee", "Job Title", "Hire Date", "Training Type", "Completion", "Due Date", "Status"],
      rows: records.map((r) => {
        const e = employeeById.get(r.employee_id);
        return [
          e ? `${e.first_name} ${e.last_name}` : r.employee_id,
          e?.job_title ?? "",
          e?.hire_date ?? "",
          trainingTypeById.get(r.training_type_id)?.name ?? "",
          r.completion_date ?? "",
          r.due_date ?? "",
          r.status,
        ];
      }),
      summaryCards,
    };
  }

  if (reportId === "employee-transcript") {
    const employee = ctx.employeeIdOverride ? employeeById.get(ctx.employeeIdOverride) : undefined;
    const records = ctx.employeeIdOverride
      ? ctx.trainingRecords.filter(
          (r) => r.employee_id === ctx.employeeIdOverride && inDateRange(r.due_date, ctx.dateFrom, ctx.dateTo)
        )
      : [];
    const practicums = ctx.employeeIdOverride
      ? ctx.practicums.filter((p) => p.employee_id === ctx.employeeIdOverride && inDateRange(p.due_date, ctx.dateFrom, ctx.dateTo))
      : [];
    summaryCards.push(
      { label: "Employee", value: employee ? `${employee.first_name} ${employee.last_name}` : "Unknown" },
      { label: "Training Records", value: records.length },
      { label: "Practicums", value: practicums.length }
    );
    return {
      headers: ["Training Type", "Completion Date", "Due Date", "Status", "Trainer", "Hours", "Method"],
      rows: records.map((r) => [
        trainingTypeById.get(r.training_type_id)?.name ?? "",
        r.completion_date ?? "",
        r.due_date ?? "",
        r.status,
        r.trainer_name ?? "",
        r.hours != null ? String(r.hours) : "",
        (r.completion_method ?? "").replace(/_/g, " "),
      ]),
      summaryCards,
    };
  }

  if (reportId === "expiring-certifications") {
    const now = new Date();
    const cutoff = new Date(now.getTime() + 90 * DAY_MS);
    const records = scopedRecords.filter((r) => {
      if (!r.due_date) return false;
      const due = new Date(r.due_date);
      return due >= now && due <= cutoff && inDateRange(r.due_date, ctx.dateFrom, ctx.dateTo);
    });
    summaryCards.push({ label: "Expiring (90 days)", value: records.length, variant: records.length > 0 ? "warning" : "success" });
    return { headers: TRAINING_RECORD_HEADERS, rows: trainingRecordRows(records, employeeById, trainingTypeById), summaryCards };
  }

  if (reportId === "missing-documents") {
    const records = scopedRecords.filter(
      (r) => r.status === "missing" && r.document_required && inDateRange(r.due_date, ctx.dateFrom, ctx.dateTo)
    );
    summaryCards.push({ label: "Missing Documents", value: records.length, variant: records.length > 0 ? "warning" : "success" });
    return { headers: TRAINING_RECORD_HEADERS, rows: trainingRecordRows(records, employeeById, trainingTypeById), summaryCards };
  }

  if (reportId === "document-audit") {
    const rangedDocuments = scopedDocuments.filter((d) => inDateRange(d.created_at, ctx.dateFrom, ctx.dateTo));
    const recordsRequiringDocs = scopedRecords.filter(
      (r) => r.status === "missing" && r.document_required && inDateRange(r.due_date, ctx.dateFrom, ctx.dateTo)
    ).length;
    summaryCards.push(
      { label: "Total Documents", value: rangedDocuments.length },
      { label: "Records Need Docs", value: recordsRequiringDocs, variant: recordsRequiringDocs > 0 ? "warning" : "success" }
    );
    return {
      headers: ["File Name", "Type", "Uploaded By", "Created"],
      rows: rangedDocuments.map((d) => {
        const uploader = d.uploaded_by_profile_id ? profileById.get(d.uploaded_by_profile_id) : undefined;
        return [
          d.file_name,
          d.document_type,
          uploader ? `${uploader.first_name} ${uploader.last_name}` : d.uploaded_by_profile_id ?? "",
          d.created_at,
        ];
      }),
      summaryCards,
    };
  }

  if (reportId === "overdue-training") {
    const expiredRecords = scopedRecords.filter((r) => r.status === "expired" && inDateRange(r.due_date, ctx.dateFrom, ctx.dateTo));
    const expiredPracticums = scopedPracticums.filter((p) => p.status === "expired" && inDateRange(p.due_date, ctx.dateFrom, ctx.dateTo));
    const rows: string[][] = [
      ...expiredRecords.map((r) => {
        const e = employeeById.get(r.employee_id);
        return [
          e ? `${e.first_name} ${e.last_name}` : r.employee_id,
          e?.job_title ?? "",
          "Training",
          trainingTypeById.get(r.training_type_id)?.name ?? "",
          r.due_date ?? "",
          r.status,
        ];
      }),
      ...expiredPracticums.map((p) => {
        const e = employeeById.get(p.employee_id);
        return [
          e ? `${e.first_name} ${e.last_name}` : p.employee_id,
          e?.job_title ?? "",
          "Practicum",
          `Annual Practicum ${p.practicum_year}`,
          p.due_date ?? "",
          p.status,
        ];
      }),
    ];
    summaryCards.push({ label: "Overdue Items", value: rows.length, variant: rows.length > 0 ? "danger" : "success" });
    return { headers: ["Employee", "Job Title", "Type", "Item", "Due Date", "Status"], rows, summaryCards };
  }

  if (reportId === "credential-status") {
    const scopedCredentials = byFacility(ctx.credentials, ctx.facilityId).filter((c) =>
      inDateRange(c.expiration_date, ctx.dateFrom, ctx.dateTo)
    );
    const compliantCount = scopedCredentials.filter((c) => c.status === "compliant").length;
    const expiredCount = scopedCredentials.filter((c) => c.status === "expired").length;
    const dueSoonCount = scopedCredentials.filter((c) => c.status === "due_soon").length;
    summaryCards.push(
      { label: "Total Credentials", value: scopedCredentials.length },
      { label: "Compliant", value: compliantCount, variant: "success" },
      { label: "Expired", value: expiredCount, variant: expiredCount > 0 ? "danger" : "success" },
      { label: "Due Soon", value: dueSoonCount, variant: dueSoonCount > 0 ? "warning" : "success" }
    );
    return {
      headers: ["Employee", "Credential", "Number", "Expiration", "Status"],
      rows: scopedCredentials.map((c) => {
        const e = employeeById.get(c.employee_id);
        return [
          e ? `${e.last_name}, ${e.first_name}` : `Employee #${c.employee_id.slice(0, 8)}`,
          c.credential_label || c.credential_type.replace(/_/g, " "),
          c.credential_number ?? "—",
          c.expiration_date ?? "No expiration",
          c.status,
        ];
      }),
      summaryCards,
    };
  }

  if (reportId === "incident-log") {
    const scopedIncidents = byFacility(ctx.incidents, ctx.facilityId).filter((i) =>
      inDateRange(i.occurred_at, ctx.dateFrom, ctx.dateTo)
    );
    const openCount = scopedIncidents.filter((i) => i.status !== "closed").length;
    const criticalCount = scopedIncidents.filter((i) => i.severity === "critical").length;
    summaryCards.push(
      { label: "Total Incidents", value: scopedIncidents.length },
      { label: "Open", value: openCount, variant: openCount > 0 ? "warning" : "success" },
      { label: "Critical", value: criticalCount, variant: criticalCount > 0 ? "danger" : "success" }
    );
    const facilityNameById = new Map(ctx.facilities.map((f) => [f.id, f.name]));
    return {
      headers: ["Occurred", "Facility", "Type", "Severity", "Status"],
      rows: scopedIncidents.map((i) => [
        new Date(i.occurred_at).toLocaleString(),
        facilityNameById.get(i.facility_id) ?? "—",
        i.incident_type.replace(/_/g, " "),
        i.severity,
        i.status,
      ]),
      summaryCards,
    };
  }

  if (reportId === "incident-notification-register") {
    const incidentById = new Map(ctx.incidents.map((i) => [i.id, i]));
    const facilityNameById = new Map(ctx.facilities.map((f) => [f.id, f.name]));
    const scopedNotifications = ctx.incidentNotifications
      .filter((n) => {
        const incident = incidentById.get(n.incident_id);
        if (!incident) return false;
        if (ctx.facilityId !== "all" && incident.facility_id !== ctx.facilityId) return false;
        return inDateRange(n.due_at, ctx.dateFrom, ctx.dateTo);
      })
      .sort((a, b) => (a.due_at < b.due_at ? 1 : -1));
    const completedCount = scopedNotifications.filter((n) => n.status === "completed").length;
    const overdueCount = scopedNotifications.filter((n) => n.status === "overdue").length;
    summaryCards.push(
      { label: "Total Notifications", value: scopedNotifications.length },
      { label: "Completed", value: completedCount, variant: "success" },
      { label: "Overdue", value: overdueCount, variant: overdueCount > 0 ? "danger" : "success" }
    );
    return {
      headers: ["Incident", "Facility", "Notification Type", "Due", "Completed", "Method", "Recipient", "Reference #", "Status"],
      rows: scopedNotifications.map((n) => {
        const incident = incidentById.get(n.incident_id);
        return [
          incident ? `${incident.incident_type.replace(/_/g, " ")} (${new Date(incident.occurred_at).toLocaleDateString()})` : n.incident_id,
          incident ? facilityNameById.get(incident.facility_id) ?? "—" : "—",
          n.notification_type.replace(/_/g, " "),
          new Date(n.due_at).toLocaleString(),
          n.completed_at ? new Date(n.completed_at).toLocaleString() : "",
          n.notification_method ?? "",
          n.recipient ?? "",
          n.reference_number ?? "",
          n.status,
        ];
      }),
      summaryCards,
    };
  }

  if (reportId === "inspection-compliance") {
    const scopedItems = byFacility(ctx.inspectionItems, ctx.facilityId).filter(
      (i) => i.is_active && inDateRange(i.next_due_date, ctx.dateFrom, ctx.dateTo)
    );
    const compliantCount = scopedItems.filter((i) => i.status === "compliant").length;
    const expiredCount = scopedItems.filter((i) => i.status === "expired").length;
    const dueSoonCount = scopedItems.filter((i) => i.status === "due_soon").length;
    summaryCards.push(
      { label: "Total Items", value: scopedItems.length },
      { label: "Compliant", value: compliantCount, variant: "success" },
      { label: "Overdue", value: expiredCount, variant: expiredCount > 0 ? "danger" : "success" },
      { label: "Due Soon", value: dueSoonCount, variant: dueSoonCount > 0 ? "warning" : "success" }
    );
    const facilityNameById = new Map(ctx.facilities.map((f) => [f.id, f.name]));
    return {
      headers: ["Facility", "Item", "Type", "Next Due", "Status"],
      rows: scopedItems.map((i) => [
        facilityNameById.get(i.facility_id) ?? "—",
        i.label,
        i.item_type.replace(/_/g, " "),
        i.next_due_date ?? "—",
        i.status,
      ]),
      summaryCards,
    };
  }

  return { headers: [], rows: [], summaryCards: [] };
}

function toCsv(headers: string[], rows: string[][]): string {
  const allRows = [headers, ...rows];
  return allRows
    .map((row) =>
      row
        .map((cell) => {
          const str = String(cell ?? "");
          if (str.includes(",") || str.includes('"') || str.includes("\n")) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        })
        .join(",")
    )
    .join("\n");
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Reports() {
  const [facilityId, setFacilityId] = useState<string>("all");
  const [category, setCategory] = useState<string>("All");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [pendingReport, setPendingReport] = useState<ReportDef | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("none");

  const [activeReport, setActiveReport] = useState<ReportDef | null>(null);
  const [reportData, setReportData] = useState<{
    headers: string[];
    rows: string[][];
    summaryCards: SummaryCard[];
    generatedAt: string;
  } | null>(null);

  const { toast } = useToast();
  const { user } = useAuth();

  const facilitiesQuery = useListFacilities({});
  const employeesQuery = useListEmployees({});
  const trainingTypesQuery = useListTrainingTypes({});
  const trainingRecordsQuery = useListTrainingRecords({});
  const practicumsQuery = useListPracticums({});
  const documentsQuery = useListDocuments({});
  const alertsQuery = useListAlerts({ status: "open" });
  const hourBucketsQuery = useListTrainingHourBuckets({});
  const organizationsQuery = useListOrganizations();
  const profilesQuery = useListProfiles({});
  const credentialsQuery = useListEmployeeCredentials({});
  const incidentsQuery = useListIncidents({});
  const incidentNotificationsQuery = useListAllIncidentNotificationsDetailed();
  const inspectionItemsQuery = useListInspectionItems({});

  const facilities = facilitiesQuery.data ?? [];
  const employees = employeesQuery.data ?? [];
  const trainingTypes = trainingTypesQuery.data ?? [];
  const trainingRecords = trainingRecordsQuery.data ?? [];
  const practicums = practicumsQuery.data ?? [];
  const documents = documentsQuery.data ?? [];
  const alerts = alertsQuery.data ?? [];
  const hourBuckets = hourBucketsQuery.data ?? [];
  const organizations = organizationsQuery.data ?? [];
  const profiles = profilesQuery.data ?? [];
  const credentials = credentialsQuery.data ?? [];
  const incidents = incidentsQuery.data ?? [];
  const incidentNotifications = incidentNotificationsQuery.data ?? [];
  const inspectionItems = inspectionItemsQuery.data ?? [];

  const dataLoading =
    facilitiesQuery.isLoading ||
    employeesQuery.isLoading ||
    trainingTypesQuery.isLoading ||
    trainingRecordsQuery.isLoading ||
    practicumsQuery.isLoading ||
    documentsQuery.isLoading ||
    alertsQuery.isLoading ||
    hourBucketsQuery.isLoading ||
    organizationsQuery.isLoading ||
    profilesQuery.isLoading ||
    credentialsQuery.isLoading ||
    incidentsQuery.isLoading ||
    incidentNotificationsQuery.isLoading ||
    inspectionItemsQuery.isLoading;

  const facilityName = facilityId !== "all" ? facilities.find((f) => f.id === facilityId)?.name : undefined;

  const visibleReports = ALL_REPORTS.filter((r) => {
    if (r.roles && !r.roles.includes(user?.role ?? "")) return false;
    if (category !== "All" && r.category !== category) return false;
    if (search) {
      const s = search.toLowerCase();
      return (
        r.title.toLowerCase().includes(s) ||
        r.description.toLowerCase().includes(s) ||
        r.category.toLowerCase().includes(s)
      );
    }
    return true;
  });

  const buildContext = useCallback(
    (employeeIdOverride?: string): ReportContext => ({
      facilityId,
      employeeIdOverride,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      facilities,
      employees,
      trainingTypes,
      trainingRecords,
      practicums,
      documents,
      alerts,
      organizations,
      profiles,
      hourBuckets,
      credentials,
      incidents,
      incidentNotifications,
      inspectionItems,
    }),
    [
      facilityId, dateFrom, dateTo, facilities, employees, trainingTypes, trainingRecords, practicums, documents, alerts, organizations,
      profiles, hourBuckets, credentials, incidents, incidentNotifications, inspectionItems,
    ]
  );

  const viewReport = useCallback(
    (report: ReportDef, employeeIdOverride?: string) => {
      try {
        const parsed = buildReport(report.id, buildContext(employeeIdOverride));
        setActiveReport(report);
        setReportData({ ...parsed, generatedAt: new Date().toISOString() });
        setPendingReport(null);
      } catch (err) {
        toast({
          title: "Failed to generate report",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
      }
    },
    [buildContext, toast]
  );

  const exportCsv = useCallback(
    (report: ReportDef, employeeIdOverride?: string) => {
      try {
        const parsed = buildReport(report.id, buildContext(employeeIdOverride));
        const csv = toCsv(parsed.headers, parsed.rows);
        const timestamp = new Date().toISOString().split("T")[0];
        downloadCsv(csv, `${report.id}-${timestamp}.csv`);
        toast({ title: `${report.title} exported` });
        setPendingReport(null);
      } catch (err) {
        toast({
          title: "Export failed",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
      }
    },
    [buildContext, toast]
  );

  const handleReportAction = (report: ReportDef, action: "view" | "csv") => {
    if (report.requiresEmployee) {
      setSelectedEmployeeId("none");
      setPendingReport(report);
      return;
    }
    if (action === "view") viewReport(report);
    else exportCsv(report);
  };

  const handleEmployeeReportAction = (action: "view" | "csv") => {
    if (!pendingReport) return;
    if (selectedEmployeeId === "none") {
      toast({ title: "Please select an employee", variant: "destructive" });
      return;
    }
    if (action === "view") viewReport(pendingReport, selectedEmployeeId);
    else exportCsv(pendingReport, selectedEmployeeId);
  };

  const handleCloseViewer = () => {
    setActiveReport(null);
    setReportData(null);
  };

  const handleExportCurrentCsv = () => {
    if (!reportData || !activeReport) return;
    const csv = toCsv(reportData.headers, reportData.rows);
    const timestamp = new Date().toISOString().split("T")[0];
    downloadCsv(csv, `${activeReport.id}-${timestamp}.csv`);
    toast({ title: `${activeReport.title} exported` });
  };

  if (activeReport && reportData) {
    return (
      <div className="space-y-4">
        <ReportViewer
          title={activeReport.title}
          subtitle={activeReport.description}
          category={activeReport.category}
          requiredBy={activeReport.requiredBy}
          generatedAt={reportData.generatedAt}
          facilityName={facilityName}
          headers={reportData.headers}
          rows={reportData.rows}
          summaryCards={reportData.summaryCards}
          onClose={handleCloseViewer}
          onExportCsv={handleExportCurrentCsv}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Compliance Reports
          </h1>
          <p className="text-muted-foreground">
            Generate, view, print, and export compliance reports for your
            organization.
          </p>
        </div>
        <Select value={facilityId} onValueChange={setFacilityId}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="All Facilities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Facilities</SelectItem>
            {facilities.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search reports..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Tabs
          value={category}
          onValueChange={setCategory}
          className="hidden md:block"
        >
          <TabsList>
            {CATEGORIES.map((c) => (
              <TabsTrigger key={c} value={c} className="text-xs">
                {c}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Select
          value={category}
          onValueChange={setCategory}
          defaultValue="All"
        >
          <SelectTrigger className="w-40 md:hidden">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          <Label htmlFor="report-date-from" className="text-xs text-muted-foreground whitespace-nowrap">
            From
          </Label>
          <Input
            id="report-date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-40"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Label htmlFor="report-date-to" className="text-xs text-muted-foreground whitespace-nowrap">
            To
          </Label>
          <Input
            id="report-date-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-40"
          />
        </div>
        {(dateFrom || dateTo) && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground"
            onClick={() => {
              setDateFrom("");
              setDateTo("");
            }}
          >
            Clear dates
          </Button>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        {visibleReports.length} report{visibleReports.length !== 1 ? "s" : ""}{" "}
        available
        {facilityName && (
          <span>
            {" "}
            &middot; Filtered to <strong>{facilityName}</strong>
          </span>
        )}
        {(dateFrom || dateTo) && (
          <span>
            {" "}
            &middot; Date range: <strong>{dateFrom || "any"}</strong> to <strong>{dateTo || "any"}</strong>
          </span>
        )}
        {dataLoading && <span className="ml-2 text-xs">(loading report data…)</span>}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {visibleReports.map((report) => {
          const Icon = report.icon;
          const catColors: Record<string, { border: string; bg: string; text: string }> = {
            Compliance: { border: "border-l-blue-500", bg: "bg-blue-100 dark:bg-blue-950/30", text: "text-blue-600 dark:text-blue-400" },
            Training: { border: "border-l-emerald-500", bg: "bg-emerald-100 dark:bg-emerald-950/30", text: "text-emerald-600 dark:text-emerald-400" },
            Practicum: { border: "border-l-purple-500", bg: "bg-purple-100 dark:bg-purple-950/30", text: "text-purple-600 dark:text-purple-400" },
            Hours: { border: "border-l-amber-500", bg: "bg-amber-100 dark:bg-amber-950/30", text: "text-amber-600 dark:text-amber-400" },
            Staff: { border: "border-l-indigo-500", bg: "bg-indigo-100 dark:bg-indigo-950/30", text: "text-indigo-600 dark:text-indigo-400" },
            Documents: { border: "border-l-slate-500", bg: "bg-slate-100 dark:bg-slate-950/30", text: "text-slate-600 dark:text-slate-400" },
            Credentials: { border: "border-l-teal-500", bg: "bg-teal-100 dark:bg-teal-950/30", text: "text-teal-600 dark:text-teal-400" },
            Incidents: { border: "border-l-rose-500", bg: "bg-rose-100 dark:bg-rose-950/30", text: "text-rose-600 dark:text-rose-400" },
            Inspections: { border: "border-l-cyan-500", bg: "bg-cyan-100 dark:bg-cyan-950/30", text: "text-cyan-600 dark:text-cyan-400" },
          };
          const colors = catColors[report.category] ?? catColors.Compliance;
          return (
            <Card
              key={report.id}
              className={`group hover:shadow-md transition-shadow flex flex-col border-l-4 ${colors.border}`}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start gap-3">
                  <div className={`h-10 w-10 rounded-lg ${colors.bg} flex items-center justify-center shrink-0`}>
                    <Icon className={`h-5 w-5 ${colors.text}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-sm leading-tight">
                      {report.title}
                    </CardTitle>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-[10px]">
                        {report.category}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px] font-normal">
                        {report.requiredBy}
                      </Badge>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col">
                <p className="text-xs text-muted-foreground mb-4 flex-1">
                  {report.description}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="default"
                    disabled={dataLoading}
                    onClick={() => handleReportAction(report, "view")}
                    className="flex-1"
                  >
                    {dataLoading ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                      <Eye className="h-3.5 w-3.5 mr-1" />
                    )}
                    View
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={dataLoading}
                    onClick={() => handleReportAction(report, "csv")}
                  >
                    <Download className="h-3.5 w-3.5 mr-1" />
                    CSV
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {visibleReports.length === 0 && (
          <div className="col-span-full text-center py-16 text-muted-foreground">
            No reports match your search.
          </div>
        )}
      </div>

      <Dialog
        open={!!pendingReport}
        onOpenChange={(open) => {
          if (!open) setPendingReport(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pendingReport?.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Select the employee for this report.
            </p>
            <div className="space-y-2">
              <Label htmlFor="emp-select">Employee</Label>
              <Select
                value={selectedEmployeeId}
                onValueChange={setSelectedEmployeeId}
              >
                <SelectTrigger id="emp-select">
                  <SelectValue placeholder="Select an employee..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Select an employee...</SelectItem>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.first_name} {e.last_name}
                      {e.job_title ? ` — ${e.job_title}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingReport(null)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => handleEmployeeReportAction("csv")}
              disabled={selectedEmployeeId === "none" || dataLoading}
            >
              <Download className="mr-2 h-4 w-4" />
              CSV
            </Button>
            <Button
              onClick={() => handleEmployeeReportAction("view")}
              disabled={selectedEmployeeId === "none" || dataLoading}
            >
              {dataLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Eye className="mr-2 h-4 w-4" />
              )}
              View Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
