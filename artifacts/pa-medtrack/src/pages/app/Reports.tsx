import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { useListOrganizations, type Organization } from "@/hooks/useOrganizations";
import { supabase } from "@/lib/supabase";
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
    requiredBy: "28 Pa. Code §2600",
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
    requiredBy: "28 Pa. Code §2600.77",
  },
  {
    id: "training-matrix",
    title: "Training Matrix",
    description:
      "Cross-reference matrix showing each employee's status across all required training types.",
    icon: Grid3X3,
    category: "Training",
    requiredBy: "28 Pa. Code §2600.77",
  },
  {
    id: "practicum-status",
    title: "Practicum Status",
    description:
      "Completion status of required annual medication administration practicums.",
    icon: CheckCircle,
    category: "Practicum",
    requiredBy: "28 Pa. Code §2600.78",
  },
  {
    id: "annual-practicum",
    title: "Annual Practicum Report",
    description:
      "Detailed view of annual practicum records including MAR review and direct observation.",
    icon: CheckCircle,
    category: "Practicum",
    requiredBy: "28 Pa. Code §2600.78",
  },
  {
    id: "annual-hours",
    title: "Annual Training Hours",
    description:
      "PCH 12-hour and ALR 16-hour annual training hour requirements with completion tracking.",
    icon: Clock,
    category: "Hours",
    requiredBy: "28 Pa. Code §2600.64",
  },
  {
    id: "training-hours",
    title: "Training Hours Detail",
    description:
      "Detailed training hours breakdown by employee and training year.",
    icon: Clock,
    category: "Hours",
    requiredBy: "28 Pa. Code §2600.64",
  },
  {
    id: "trainer-certification",
    title: "Trainer Certification Status",
    description:
      "Track initial and recertification status for all designated trainers.",
    icon: GraduationCap,
    category: "Staff",
    requiredBy: "28 Pa. Code §2600.77(g)",
  },
  {
    id: "new-employee-training",
    title: "New Employee Training",
    description:
      "Training completion for recently hired staff within their first 90 days.",
    icon: Users,
    category: "Staff",
    requiredBy: "28 Pa. Code §2600.77",
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
    id: "org-compliance",
    title: "Organization Compliance Overview",
    description:
      "High-level compliance metrics and trends across the entire organization.",
    icon: BarChart3,
    category: "Compliance",
    requiredBy: "28 Pa. Code §2600",
    roles: ["platform_admin"],
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

// `employee_training_hour_buckets` has no dedicated hook yet elsewhere in the app,
// so this report page queries it directly (same pattern as the other hooks/*.ts files).
type HourBucket = Tables<"employee_training_hour_buckets">;

interface ListTrainingHourBucketsFilters {
  facilityId?: string;
}

function useListTrainingHourBuckets(filters: ListTrainingHourBucketsFilters = {}) {
  return useQuery({
    queryKey: ["training_hour_buckets", filters],
    queryFn: async () => {
      let query = supabase
        .from("employee_training_hour_buckets")
        .select("*")
        .order("training_year", { ascending: false });
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

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
  facilities: Facility[];
  employees: Employee[];
  trainingTypes: TrainingType[];
  trainingRecords: TrainingRecord[];
  practicums: Practicum[];
  documents: TrainingDocument[];
  alerts: Alert[];
  organizations: Organization[];
  hourBuckets: HourBucket[];
}

function buildReport(reportId: string, ctx: ReportContext): ParsedReport {
  const summaryCards: SummaryCard[] = [];

  const scopedEmployees = byFacility(ctx.employees, ctx.facilityId).filter((e) => e.status === "active");
  const scopedRecords = byFacility(ctx.trainingRecords, ctx.facilityId);
  const scopedPracticums = byFacility(ctx.practicums, ctx.facilityId);
  const scopedDocuments = byFacility(ctx.documents, ctx.facilityId);

  const employeeById = new Map(ctx.employees.map((e) => [e.id, e]));
  const trainingTypeById = new Map(ctx.trainingTypes.map((t) => [t.id, t]));

  if (reportId === "compliance-summary") {
    const total = relevantRecords(scopedRecords).length;
    const compliantCount = scopedRecords.filter((r) => r.status === "compliant").length;
    const expiredCount = scopedRecords.filter((r) => r.status === "expired").length;
    const dueSoonCount = scopedRecords.filter((r) => r.status === "due_soon").length;
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
      const records = ctx.trainingRecords.filter((r) => r.facility_id === f.id);
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
    const total = relevantRecords(scopedRecords).length;
    const compliantCount = scopedRecords.filter((r) => r.status === "compliant").length;
    const expiredCount = scopedRecords.filter((r) => r.status === "expired").length;
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

    const medAdminBadRecords = scopedRecords.filter(
      (r) => medAdminIds.has(r.employee_id) && medAdminTypeIds.has(r.training_type_id) && (r.status === "expired" || r.status === "missing")
    );
    const trainerBadRecords = scopedRecords.filter(
      (r) => trainerIds.has(r.employee_id) && trainerTypeIds.has(r.training_type_id) && (r.status === "expired" || r.status === "missing")
    );

    const currentYear = new Date().getFullYear();
    const yearPracticums = scopedPracticums.filter((p) => p.practicum_year === currentYear);
    const pendingPracticums = yearPracticums.filter((p) => p.status !== "compliant");

    const missingDocsRecords = scopedRecords.filter((r) => r.status === "missing" && r.document_required);

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
    const records = scopedRecords.filter((r) => r.status === "expired");
    summaryCards.push({ label: "Expired Records", value: records.length, variant: records.length > 0 ? "danger" : "success" });
    return { headers: TRAINING_RECORD_HEADERS, rows: trainingRecordRows(records, employeeById, trainingTypeById), summaryCards };
  }

  if (reportId === "due-soon") {
    const records = scopedRecords.filter((r) => r.status === "due_soon");
    summaryCards.push({ label: "Due Soon Records", value: records.length, variant: records.length > 0 ? "warning" : "success" });
    return { headers: TRAINING_RECORD_HEADERS, rows: trainingRecordRows(records, employeeById, trainingTypeById), summaryCards };
  }

  if (reportId === "medication-administration") {
    const medAdminEmployees = scopedEmployees.filter((e) => e.administers_medications);
    const medAdminIds = new Set(medAdminEmployees.map((e) => e.id));
    const medAdminTypeIds = new Set(
      ctx.trainingTypes.filter((t) => t.is_active && t.applies_to_administers_meds).map((t) => t.id)
    );
    const records = scopedRecords.filter((r) => medAdminIds.has(r.employee_id) && medAdminTypeIds.has(r.training_type_id));
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

    return {
      headers: ["Employee", "Job Title", ...matrixTypes.map((t) => t.name)],
      rows: scopedEmployees.map((e) => [
        `${e.first_name} ${e.last_name}`,
        e.job_title ?? "",
        ...matrixTypes.map((t) => latestStatus(e.id, t.id)),
      ]),
      summaryCards: [
        { label: "Employees", value: scopedEmployees.length },
        { label: "Training Types", value: matrixTypes.length },
      ],
    };
  }

  if (reportId === "practicum-status") {
    const medAdminEmployees = scopedEmployees.filter((e) => e.administers_medications);
    const compliantCount = scopedPracticums.filter((p) => p.status === "compliant").length;
    const pendingCount = scopedPracticums.length - compliantCount;
    summaryCards.push(
      { label: "Med Admin Staff", value: medAdminEmployees.length },
      { label: "Compliant", value: compliantCount, variant: "success" },
      { label: "Pending", value: pendingCount, variant: pendingCount > 0 ? "warning" : "success" }
    );
    return {
      headers: ["Employee ID", "Year", "Status", "Completion Date"],
      rows: scopedPracticums.map((p) => [p.employee_id, String(p.practicum_year), p.status, p.completion_date ?? ""]),
      summaryCards,
    };
  }

  if (reportId === "annual-practicum") {
    const completed = scopedPracticums.filter((p) => p.status === "compliant").length;
    const pending = scopedPracticums.length - completed;
    summaryCards.push(
      { label: "Total Required", value: scopedPracticums.length },
      { label: "Completed", value: completed, variant: "success" },
      { label: "Pending", value: pending, variant: pending > 0 ? "warning" : "success" }
    );
    return {
      headers: ["Employee ID", "Year", "Status", "Completion Date", "Observed By", "MAR Review", "Direct Observation"],
      rows: scopedPracticums.map((p) => [
        p.employee_id,
        String(p.practicum_year),
        p.status,
        p.completion_date ?? "",
        p.observed_by ?? "",
        p.mar_review_completed ? "Yes" : "No",
        p.direct_observation_completed ? "Yes" : "No",
      ]),
      summaryCards,
    };
  }

  if (reportId === "annual-hours" || reportId === "training-hours") {
    const scopedBuckets = byFacility(ctx.hourBuckets, ctx.facilityId);
    const currentYear = new Date().getFullYear();
    const buckets = reportId === "annual-hours" ? scopedBuckets.filter((b) => b.training_year === currentYear) : scopedBuckets;
    const compliantCount = buckets.filter((b) => b.status === "compliant").length;
    const incompleteCount = buckets.length - compliantCount;
    summaryCards.push(
      { label: "Staff Tracked", value: buckets.length },
      { label: "Compliant", value: compliantCount, variant: "success" },
      { label: "Incomplete", value: incompleteCount, variant: incompleteCount > 0 ? "warning" : "success" }
    );
    return {
      headers: ["Employee ID", "Year", "Required Hours", "Completed Hours", "Remaining", "Status"],
      rows: buckets.map((b) => {
        const req = Number(b.required_hours ?? 0);
        const comp = Number(b.completed_hours ?? 0);
        return [b.employee_id, String(b.training_year), String(req), String(comp), String(Math.max(0, req - comp)), b.status];
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
    const records = scopedRecords.filter((r) => trainerIds.has(r.employee_id) && trainerTypeIds.has(r.training_type_id));
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
    const records = scopedRecords.filter((r) => newHireIds.has(r.employee_id));
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
      ? ctx.trainingRecords.filter((r) => r.employee_id === ctx.employeeIdOverride)
      : [];
    const practicums = ctx.employeeIdOverride
      ? ctx.practicums.filter((p) => p.employee_id === ctx.employeeIdOverride)
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
      return due >= now && due <= cutoff;
    });
    summaryCards.push({ label: "Expiring (90 days)", value: records.length, variant: records.length > 0 ? "warning" : "success" });
    return { headers: TRAINING_RECORD_HEADERS, rows: trainingRecordRows(records, employeeById, trainingTypeById), summaryCards };
  }

  if (reportId === "missing-documents") {
    const records = scopedRecords.filter((r) => r.status === "missing" && r.document_required);
    summaryCards.push({ label: "Missing Documents", value: records.length, variant: records.length > 0 ? "warning" : "success" });
    return { headers: TRAINING_RECORD_HEADERS, rows: trainingRecordRows(records, employeeById, trainingTypeById), summaryCards };
  }

  if (reportId === "document-audit") {
    const recordsRequiringDocs = scopedRecords.filter((r) => r.status === "missing" && r.document_required).length;
    summaryCards.push(
      { label: "Total Documents", value: scopedDocuments.length },
      { label: "Records Need Docs", value: recordsRequiringDocs, variant: recordsRequiringDocs > 0 ? "warning" : "success" }
    );
    return {
      headers: ["File Name", "Type", "Uploaded By", "Created"],
      rows: scopedDocuments.map((d) => [d.file_name, d.document_type, d.uploaded_by_profile_id ?? "", d.created_at]),
      summaryCards,
    };
  }

  if (reportId === "overdue-training") {
    const expiredRecords = scopedRecords.filter((r) => r.status === "expired");
    const expiredPracticums = scopedPracticums.filter((p) => p.status === "expired");
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

  if (reportId === "org-compliance") {
    const rows = ctx.organizations.map((o) => {
      const orgFacilities = ctx.facilities.filter((f) => f.organization_id === o.id);
      const orgEmployees = ctx.employees.filter((e) => e.organization_id === o.id);
      const orgRecords = ctx.trainingRecords.filter((r) => r.organization_id === o.id);
      const relevantOrgRecords = relevantRecords(orgRecords);
      const compliantCount = orgRecords.filter((r) => r.status === "compliant").length;
      const expiredCount = orgRecords.filter((r) => r.status === "expired").length;
      const dueSoonCount = orgRecords.filter((r) => r.status === "due_soon").length;
      return {
        org: o,
        totalEmployees: orgEmployees.length,
        totalFacilities: orgFacilities.length,
        totalRecords: relevantOrgRecords.length,
        compliantCount,
        expiredCount,
        dueSoonCount,
        compliancePercentage: pct(compliantCount, relevantOrgRecords.length),
      };
    });
    return {
      headers: ["Org ID", "Total Employees", "Facilities", "Total Records", "Compliant", "Expired", "Due Soon", "Compliance %"],
      rows: rows.map((r) => [
        r.org.name,
        String(r.totalEmployees),
        String(r.totalFacilities),
        String(r.totalRecords),
        String(r.compliantCount),
        String(r.expiredCount),
        String(r.dueSoonCount),
        `${r.compliancePercentage}%`,
      ]),
      summaryCards: [{ label: "Organizations", value: rows.length }],
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

  const facilities = facilitiesQuery.data ?? [];
  const employees = employeesQuery.data ?? [];
  const trainingTypes = trainingTypesQuery.data ?? [];
  const trainingRecords = trainingRecordsQuery.data ?? [];
  const practicums = practicumsQuery.data ?? [];
  const documents = documentsQuery.data ?? [];
  const alerts = alertsQuery.data ?? [];
  const hourBuckets = hourBucketsQuery.data ?? [];
  const organizations = organizationsQuery.data ?? [];

  const dataLoading =
    facilitiesQuery.isLoading ||
    employeesQuery.isLoading ||
    trainingTypesQuery.isLoading ||
    trainingRecordsQuery.isLoading ||
    practicumsQuery.isLoading ||
    documentsQuery.isLoading ||
    alertsQuery.isLoading ||
    hourBucketsQuery.isLoading ||
    organizationsQuery.isLoading;

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
      facilities,
      employees,
      trainingTypes,
      trainingRecords,
      practicums,
      documents,
      alerts,
      organizations,
      hourBuckets,
    }),
    [facilityId, facilities, employees, trainingTypes, trainingRecords, practicums, documents, alerts, organizations, hourBuckets]
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
