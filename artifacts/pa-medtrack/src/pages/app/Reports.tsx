import { useState, useCallback } from "react";
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
import { useListFacilities, useListEmployees } from "@workspace/api-client-react";
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

function parseReportData(
  data: Record<string, unknown>,
  reportId: string
): {
  headers: string[];
  rows: string[][];
  summaryCards: SummaryCard[];
} {
  const summaryCards: SummaryCard[] = [];

  if (reportId === "compliance-summary") {
    const pct = Number(data.compliancePercentage ?? 0);
    summaryCards.push(
      { label: "Total Employees", value: data.totalEmployees as number, variant: "default" },
      { label: "Compliant", value: data.compliantCount as number, variant: "success" },
      { label: "Expired", value: data.expiredCount as number, variant: (data.expiredCount as number) > 0 ? "danger" : "success" },
      { label: "Compliance", value: `${pct}%`, variant: pct >= 80 ? "success" : pct >= 50 ? "warning" : "danger" }
    );
    return {
      headers: ["Metric", "Value"],
      rows: [
        ["Total Employees", String(data.totalEmployees ?? "")],
        ["Total Training Records", String(data.totalRecords ?? "")],
        ["Compliant Records", String(data.compliantCount ?? "")],
        ["Expired Records", String(data.expiredCount ?? "")],
        ["Due Soon Records", String(data.dueSoonCount ?? "")],
        ["Compliance Percentage", `${pct}%`],
      ],
      summaryCards,
    };
  }

  if (reportId === "facility-compliance") {
    const facilities = (data.facilities as Array<Record<string, unknown>>) ?? [];
    return {
      headers: ["Facility", "Type", "Total Records", "Compliant", "Expired", "Due Soon", "Compliance %"],
      rows: facilities.map((f) => [
        String(f.facilityName ?? f.name ?? ""),
        String(f.facilityType ?? f.type ?? "").replace(/_/g, " "),
        String(f.total ?? ""),
        String(f.compliantCount ?? ""),
        String(f.expiredCount ?? ""),
        String(f.dueSoonCount ?? ""),
        `${f.complianceScore ?? ""}%`,
      ]),
      summaryCards: [
        { label: "Facilities", value: facilities.length },
        { label: "Avg Score", value: facilities.length > 0 ? `${Math.round(facilities.reduce((a, f) => a + Number(f.complianceScore ?? 0), 0) / facilities.length)}%` : "—", variant: "default" },
      ],
    };
  }

  if (reportId === "survey-readiness") {
    const checks = (data.readinessChecks as Array<Record<string, unknown>>) ?? [];
    summaryCards.push(
      { label: "Readiness Score", value: `${data.surveyReadinessScore}%`, variant: Number(data.surveyReadinessScore) >= 80 ? "success" : Number(data.surveyReadinessScore) >= 50 ? "warning" : "danger" },
      { label: "Compliance Score", value: `${data.overallComplianceScore}%`, variant: Number(data.overallComplianceScore) >= 80 ? "success" : "warning" },
      { label: "Active Staff", value: data.totalActiveStaff as number },
      { label: "Med Admin Staff", value: data.medAdminStaff as number }
    );
    return {
      headers: ["Check", "Status", "Detail"],
      rows: checks.map((c) => [
        String(c.check ?? ""),
        String(c.status ?? ""),
        String(c.detail ?? ""),
      ]),
      summaryCards,
    };
  }

  if (reportId === "training-matrix") {
    const matrix = (data.matrix as Array<Record<string, unknown>>) ?? [];
    const trainingTypes = (data.trainingTypes as Array<Record<string, unknown>>) ?? [];
    if (!matrix.length) return { headers: [], rows: [], summaryCards: [] };
    const typeHeaders = trainingTypes.map((t) => String(t.name ?? t.id ?? ""));
    const typeIds = trainingTypes.map((t) => String(t.id ?? ""));
    return {
      headers: ["Employee", "Job Title", ...typeHeaders],
      rows: matrix.map((e) => {
        const statusByType = (e.statusByType ?? {}) as Record<string, string>;
        return [
          String(e.employeeName ?? ""),
          String(e.jobTitle ?? ""),
          ...typeIds.map((tid) => String(statusByType[tid] ?? "no_record")),
        ];
      }),
      summaryCards: [
        { label: "Employees", value: matrix.length },
        { label: "Training Types", value: trainingTypes.length },
      ],
    };
  }

  if (reportId === "org-compliance") {
    const orgs = (data.organizations as Array<Record<string, unknown>>) ?? [];
    return {
      headers: ["Org ID", "Total Employees", "Facilities", "Total Records", "Compliant", "Expired", "Due Soon", "Compliance %"],
      rows: orgs.map((o) => [
        String(o.orgId ?? ""),
        String(o.totalEmployees ?? ""),
        String(o.totalFacilities ?? ""),
        String(o.totalRecords ?? ""),
        String(o.compliantCount ?? ""),
        String(o.expiredCount ?? ""),
        String(o.dueSoonCount ?? ""),
        `${o.compliancePercentage ?? ""}%`,
      ]),
      summaryCards: [{ label: "Organizations", value: orgs.length }],
    };
  }

  if (reportId === "annual-practicum") {
    const practicums = (data.practicums as Array<Record<string, unknown>>) ?? [];
    summaryCards.push(
      { label: "Total Required", value: data.totalRequired as number },
      { label: "Completed", value: data.completed as number, variant: "success" },
      { label: "Pending", value: data.pending as number, variant: (data.pending as number) > 0 ? "warning" : "success" }
    );
    return {
      headers: ["Employee ID", "Year", "Status", "Completion Date", "Observed By", "MAR Review", "Direct Observation"],
      rows: practicums.map((p) => [
        String(p.employeeId ?? ""),
        String(p.practicumYear ?? ""),
        String(p.status ?? ""),
        String(p.completionDate ?? ""),
        String(p.observedBy ?? ""),
        p.marReviewCompleted ? "Yes" : "No",
        p.directObservationCompleted ? "Yes" : "No",
      ]),
      summaryCards,
    };
  }

  if (reportId === "practicum-status") {
    const practicums = (data.practicums as Array<Record<string, unknown>>) ?? [];
    const employees = (data.employees as Array<Record<string, unknown>>) ?? [];
    summaryCards.push(
      { label: "Med Admin Staff", value: employees.length },
      { label: "Compliant", value: data.compliantCount as number, variant: "success" },
      { label: "Pending", value: data.pendingCount as number, variant: (data.pendingCount as number) > 0 ? "warning" : "success" }
    );
    return {
      headers: ["Employee ID", "Year", "Status", "Completion Date"],
      rows: practicums.map((p) => [
        String(p.employeeId ?? ""),
        String(p.practicumYear ?? ""),
        String(p.status ?? ""),
        String(p.completionDate ?? ""),
      ]),
      summaryCards,
    };
  }

  if (reportId === "training-hours" || reportId === "annual-hours") {
    const buckets = (data.buckets as Array<Record<string, unknown>>) ?? [];
    summaryCards.push(
      { label: "Staff Tracked", value: buckets.length },
      { label: "Compliant", value: data.compliantCount as number ?? 0, variant: "success" },
      { label: "Incomplete", value: data.incompleteCount as number ?? 0, variant: (data.incompleteCount as number) > 0 ? "warning" : "success" }
    );
    return {
      headers: ["Employee ID", "Year", "Required Hours", "Completed Hours", "Remaining", "Status"],
      rows: buckets.map((b) => {
        const req = Number(b.requiredHours ?? 0);
        const comp = Number(b.completedHours ?? 0);
        return [
          String(b.employeeId ?? ""),
          String(b.trainingYear ?? ""),
          String(req),
          String(comp),
          String(Math.max(0, req - comp)),
          String(b.status ?? ""),
        ];
      }),
      summaryCards,
    };
  }

  if (reportId === "employee-transcript") {
    const employee = data.employee as Record<string, unknown> | undefined;
    const rawRecords = (data.trainingRecords as Array<Record<string, unknown>>) ?? [];
    const practicums = (data.practicums as Array<Record<string, unknown>>) ?? [];
    const empName = employee ? `${employee.firstName} ${employee.lastName}` : "Unknown";
    summaryCards.push(
      { label: "Employee", value: empName },
      { label: "Training Records", value: rawRecords.length },
      { label: "Practicums", value: practicums.length }
    );
    return {
      headers: ["Training Type", "Completion Date", "Due Date", "Status", "Trainer", "Hours", "Method"],
      rows: rawRecords.map((r) => {
        const rec = (r.record ?? r) as Record<string, unknown>;
        const tt = (r.trainingType ?? {}) as Record<string, unknown>;
        const typeName = String(r.trainingTypeName ?? tt.name ?? rec.trainingTypeName ?? "");
        return [
          typeName,
          String(rec.completionDate ?? r.completionDate ?? ""),
          String(rec.dueDate ?? r.dueDate ?? ""),
          String(rec.status ?? r.status ?? ""),
          String(rec.trainerName ?? r.trainerName ?? ""),
          String(rec.hours ?? r.hours ?? ""),
          String(rec.completionMethod ?? r.completionMethod ?? "").replace(/_/g, " "),
        ];
      }),
      summaryCards,
    };
  }

  if (reportId === "medication-administration") {
    const employees = (data.employees as Array<Record<string, unknown>>) ?? [];
    const records = (data.trainingRecords as Array<Record<string, unknown>>) ?? [];
    summaryCards.push(
      { label: "Med Admin Staff", value: employees.length },
      { label: "Training Records", value: records.length }
    );
    const empMap = new Map(employees.map((e) => [e.id, e]));
    return {
      headers: ["Employee", "Job Title", "Hire Date", "Training Type", "Completion", "Due Date", "Status"],
      rows: records.map((r) => {
        const rec = (r.record ?? r) as Record<string, unknown>;
        const tt = (r.trainingType ?? {}) as Record<string, unknown>;
        const emp = empMap.get(rec.employeeId);
        return [
          emp ? `${emp.firstName} ${emp.lastName}` : String(rec.employeeId ?? ""),
          emp ? String(emp.jobTitle ?? "") : "",
          emp ? String(emp.hireDate ?? "") : "",
          String(tt.name ?? ""),
          String(rec.completionDate ?? ""),
          String(rec.dueDate ?? ""),
          String(rec.status ?? ""),
        ];
      }),
      summaryCards,
    };
  }

  if (reportId === "document-audit") {
    const docs = (data.documents as Array<Record<string, unknown>>) ?? [];
    summaryCards.push(
      { label: "Total Documents", value: data.totalDocuments as number },
      { label: "Records Need Docs", value: data.recordsRequiringDocs as number, variant: (data.recordsRequiringDocs as number) > 0 ? "warning" : "success" }
    );
    return {
      headers: ["File Name", "Type", "Uploaded By", "Created"],
      rows: docs.map((d) => [
        String(d.fileName ?? ""),
        String(d.documentType ?? d.fileType ?? ""),
        String(d.uploadedByUserId ?? ""),
        String(d.createdAt ?? ""),
      ]),
      summaryCards,
    };
  }

  const records = (
    (data.records as unknown[]) ??
    (data.trainingRecords as unknown[]) ??
    (data.employees as unknown[]) ??
    (data.trainers as unknown[]) ??
    (data.data as unknown[]) ??
    []
  ) as Array<Record<string, unknown>>;

  if (records.length === 0) return { headers: [], rows: [], summaryCards: [] };

  const flatRecords = records.map((r) => {
    if (r.record && typeof r.record === "object") {
      const rec = r.record as Record<string, unknown>;
      const tt = r.trainingType as Record<string, unknown> | undefined;
      return { ...rec, trainingTypeName: tt?.name ?? rec.trainingTypeName ?? "" };
    }
    return r;
  });

  const skipFields = new Set(["trainingType", "record", "organizationId", "id", "createdAt", "updatedAt"]);
  const allKeys = Object.keys(flatRecords[0]).filter((k) => !skipFields.has(k));

  const friendlyHeaders = allKeys.map((k) =>
    k.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase()).trim()
  );

  return {
    headers: friendlyHeaders,
    rows: flatRecords.map((r) =>
      allKeys.map((k) => {
        const val = r[k];
        if (val === null || val === undefined) return "";
        if (typeof val === "boolean") return val ? "Yes" : "No";
        return String(val);
      })
    ),
    summaryCards,
  };
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
  const [loadingReport, setLoadingReport] = useState<string | null>(null);
  const [pendingReport, setPendingReport] = useState<ReportDef | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("none");

  const [activeReport, setActiveReport] = useState<ReportDef | null>(null);
  const [reportData, setReportData] = useState<{
    headers: string[];
    rows: string[][];
    summaryCards: SummaryCard[];
    generatedAt: string;
  } | null>(null);

  const { data: facilities } = useListFacilities({});
  const { data: employees } = useListEmployees({});
  const { toast } = useToast();
  const { user } = useAuth();

  const facilityName =
    facilityId !== "all"
      ? facilities?.find((f) => String(f.id) === facilityId)?.name
      : undefined;

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

  const fetchReport = useCallback(
    async (
      report: ReportDef,
      employeeIdOverride?: string
    ): Promise<Record<string, unknown> | null> => {
      const params = new URLSearchParams();
      if (facilityId && facilityId !== "all")
        params.set("facilityId", facilityId);
      if (employeeIdOverride && employeeIdOverride !== "none")
        params.set("employeeId", employeeIdOverride);

      const res = await fetch(`/api/reports/${report.id}?${params}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string }).error ?? `HTTP ${res.status}`
        );
      }
      return (await res.json()) as Record<string, unknown>;
    },
    [facilityId]
  );

  const viewReport = useCallback(
    async (report: ReportDef, employeeIdOverride?: string) => {
      setLoadingReport(report.id);
      setPendingReport(null);
      try {
        const data = await fetchReport(report, employeeIdOverride);
        if (!data) return;
        const parsed = parseReportData(data, report.id);
        setActiveReport(report);
        setReportData({
          ...parsed,
          generatedAt: String(data.generatedAt ?? new Date().toISOString()),
        });
      } catch (err) {
        toast({
          title: "Failed to load report",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
      } finally {
        setLoadingReport(null);
      }
    },
    [fetchReport, toast]
  );

  const exportCsv = useCallback(
    async (report: ReportDef, employeeIdOverride?: string) => {
      setLoadingReport(report.id);
      setPendingReport(null);
      try {
        const data = await fetchReport(report, employeeIdOverride);
        if (!data) return;
        const parsed = parseReportData(data, report.id);
        const csv = toCsv(parsed.headers, parsed.rows);
        const timestamp = new Date().toISOString().split("T")[0];
        downloadCsv(csv, `${report.id}-${timestamp}.csv`);
        toast({ title: `${report.title} exported` });
      } catch (err) {
        toast({
          title: "Export failed",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
      } finally {
        setLoadingReport(null);
      }
    },
    [fetchReport, toast]
  );

  const handleReportAction = (report: ReportDef, action: "view" | "csv") => {
    if (report.requiresEmployee) {
      setSelectedEmployeeId("none");
      setPendingReport(report);
      return;
    }
    if (action === "view") void viewReport(report);
    else void exportCsv(report);
  };

  const handleEmployeeReportAction = (action: "view" | "csv") => {
    if (!pendingReport) return;
    if (selectedEmployeeId === "none") {
      toast({ title: "Please select an employee", variant: "destructive" });
      return;
    }
    if (action === "view") void viewReport(pendingReport, selectedEmployeeId);
    else void exportCsv(pendingReport, selectedEmployeeId);
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
            {facilities?.map((f) => (
              <SelectItem key={f.id} value={String(f.id)}>
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
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {visibleReports.map((report) => {
          const Icon = report.icon;
          const isLoading = loadingReport === report.id;
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
                    disabled={isLoading}
                    onClick={() => handleReportAction(report, "view")}
                    className="flex-1"
                  >
                    {isLoading ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                      <Eye className="h-3.5 w-3.5 mr-1" />
                    )}
                    View
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isLoading}
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
                  {employees?.map((e) => (
                    <SelectItem key={e.id} value={String(e.id)}>
                      {e.firstName} {e.lastName}{" "}
                      {e.jobTitle ? `— ${e.jobTitle}` : ""}
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
              disabled={
                selectedEmployeeId === "none" ||
                loadingReport === pendingReport?.id
              }
            >
              <Download className="mr-2 h-4 w-4" />
              CSV
            </Button>
            <Button
              onClick={() => handleEmployeeReportAction("view")}
              disabled={
                selectedEmployeeId === "none" ||
                loadingReport === pendingReport?.id
              }
            >
              {loadingReport === pendingReport?.id ? (
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
