import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useListFacilities } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  FileText, Users, Building2, Clock, AlertTriangle,
  GraduationCap, Files, CheckCircle, Download, Shield,
  BookOpen, BarChart3, Calendar, Search
} from "lucide-react";
import { LucideIcon } from "lucide-react";

interface ReportDef {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  category: string;
  requiredBy: string;
  roles?: string[];
}

const ALL_REPORTS: ReportDef[] = [
  {
    id: "compliance-summary",
    title: "Compliance Summary",
    description: "Overview of total, compliant, expired, and due-soon training records with compliance percentages by type.",
    icon: BarChart3,
    category: "Compliance",
    requiredBy: "28 Pa. Code §2600",
  },
  {
    id: "medication-administration",
    title: "Medication Administration Training",
    description: "Track initial and recertification training for all staff who administer medications.",
    icon: FileText,
    category: "Training",
    requiredBy: "28 Pa. Code §2600.77",
  },
  {
    id: "expired-training",
    title: "Expired Training Records",
    description: "All training records that have passed their expiration date and require renewal.",
    icon: AlertTriangle,
    category: "Compliance",
    requiredBy: "Internal Compliance",
  },
  {
    id: "due-soon",
    title: "Training Due Soon",
    description: "Training records expiring in the next 90 days to help proactively schedule renewals.",
    icon: Calendar,
    category: "Compliance",
    requiredBy: "Internal Compliance",
  },
  {
    id: "overdue-training",
    title: "Overdue Training",
    description: "All expired or overdue training requirements across the organization.",
    icon: AlertTriangle,
    category: "Compliance",
    requiredBy: "Internal Compliance",
  },
  {
    id: "missing-documents",
    title: "Missing Documents",
    description: "Training records that are missing required supporting documentation.",
    icon: Files,
    category: "Documents",
    requiredBy: "Record Keeping",
  },
  {
    id: "practicum-status",
    title: "Practicum Status",
    description: "Completion status of required annual medication administration practicums.",
    icon: CheckCircle,
    category: "Practicum",
    requiredBy: "28 Pa. Code §2600.78",
  },
  {
    id: "annual-practicum",
    title: "Annual Practicum Report",
    description: "Detailed view of annual practicum records including MAR review and direct observation.",
    icon: CheckCircle,
    category: "Practicum",
    requiredBy: "28 Pa. Code §2600.78",
  },
  {
    id: "annual-hours",
    title: "Annual Training Hours",
    description: "12-hour annual training hour requirements for PCH and ALR staff with completion tracking.",
    icon: Clock,
    category: "Annual Hours",
    requiredBy: "28 Pa. Code §2600.64",
  },
  {
    id: "training-hours",
    title: "Training Hours Detail",
    description: "Detailed training hours breakdown by employee and training year.",
    icon: Clock,
    category: "Annual Hours",
    requiredBy: "28 Pa. Code §2600.64",
  },
  {
    id: "trainer-certification",
    title: "Trainer Certification Status",
    description: "Track initial and recertification status for all designated trainers.",
    icon: GraduationCap,
    category: "Trainer",
    requiredBy: "28 Pa. Code §2600.77(g)",
  },
  {
    id: "expiring-certifications",
    title: "Expiring Certifications",
    description: "All certifications expiring within the next 90 days across the organization.",
    icon: AlertTriangle,
    category: "Alerts",
    requiredBy: "Internal Compliance",
  },
  {
    id: "new-employee-training",
    title: "New Employee Training",
    description: "Training completion for recently hired staff within their first 90 days.",
    icon: Users,
    category: "Onboarding",
    requiredBy: "28 Pa. Code §2600.77",
  },
  {
    id: "employee-transcript",
    title: "Employee Transcript",
    description: "Complete training transcript for an individual employee showing all training history.",
    icon: BookOpen,
    category: "Employee",
    requiredBy: "Record Keeping",
  },
  {
    id: "facility-compliance",
    title: "Facility Compliance Summary",
    description: "Compare compliance scores across all facilities in your organization.",
    icon: Building2,
    category: "Facility",
    requiredBy: "Survey Preparation",
  },
  {
    id: "org-compliance",
    title: "Organization Compliance Overview",
    description: "High-level compliance metrics and trends across the entire organization.",
    icon: BarChart3,
    category: "Facility",
    requiredBy: "28 Pa. Code §2600",
    roles: ["platform_admin", "org_admin"],
  },
  {
    id: "document-audit",
    title: "Document Audit",
    description: "Identify training records requiring documentation and track uploaded files.",
    icon: Files,
    category: "Documents",
    requiredBy: "Record Keeping",
  },
  {
    id: "survey-readiness",
    title: "Survey Readiness",
    description: "Comprehensive readiness assessment for state DHS survey inspections.",
    icon: Shield,
    category: "Survey",
    requiredBy: "DHS Survey Preparation",
  },
];

const CATEGORIES = ["All", "Compliance", "Training", "Practicum", "Annual Hours", "Trainer", "Employee", "Facility", "Documents", "Onboarding", "Alerts", "Survey"];

function flattenToRows(data: unknown, reportId: string): string[][] {
  if (!data || typeof data !== "object") return [["No data available"]];
  const d = data as Record<string, unknown>;

  if (reportId === "facility-compliance" || reportId === "org-compliance") {
    const facilities = (d.facilities as Array<Record<string, unknown>>) ?? [];
    if (facilities.length === 0) return [["No facility data available"]];
    const headers = ["Facility", "Type", "Total Records", "Compliant", "Expired", "Due Soon", "Compliance Score"];
    const rows = facilities.map(f => [
      String(f.facilityName ?? f.name ?? ""),
      String(f.facilityType ?? f.type ?? ""),
      String(f.total ?? ""),
      String(f.compliantCount ?? ""),
      String(f.expiredCount ?? ""),
      String(f.dueSoonCount ?? ""),
      `${String(f.complianceScore ?? "")}%`,
    ]);
    return [headers, ...rows];
  }

  if (reportId === "annual-practicum") {
    const practicums = (d.practicums as Array<Record<string, unknown>>) ?? [];
    const headers = ["Employee ID", "Practicum Year", "Status", "Completion Date", "Observed By", "MAR Review", "Direct Observation"];
    const rows = practicums.map(p => [
      String(p.employeeId ?? ""),
      String(p.practicumYear ?? ""),
      String(p.status ?? ""),
      String(p.completionDate ?? ""),
      String(p.observedBy ?? ""),
      String(p.marReviewCompleted ?? ""),
      String(p.directObservationCompleted ?? ""),
    ]);
    return rows.length ? [headers, ...rows] : [headers, ["No data"]];
  }

  if (reportId === "training-hours" || reportId === "annual-hours") {
    const buckets = (d.buckets as Array<Record<string, unknown>>) ?? [];
    const headers = ["Employee ID", "Year", "Required Hours", "Completed Hours", "Status"];
    const rows = buckets.map(b => [
      String(b.employeeId ?? ""),
      String(b.trainingYear ?? ""),
      String(b.requiredHours ?? ""),
      String(b.completedHours ?? ""),
      String(b.status ?? ""),
    ]);
    return rows.length ? [headers, ...rows] : [headers, ["No data"]];
  }

  if (reportId === "compliance-summary") {
    const totalRecords = d.totalRecords ?? d.total;
    return [
      ["Metric", "Value"],
      ["Total Employees", String(d.totalEmployees ?? "")],
      ["Total Records", String(totalRecords ?? "")],
      ["Compliant", String(d.compliantCount ?? "")],
      ["Expired", String(d.expiredCount ?? "")],
      ["Due Soon", String(d.dueSoonCount ?? "")],
      ["Compliance %", `${String(d.compliancePercentage ?? "")}%`],
      ["Generated At", String(d.generatedAt ?? "")],
    ];
  }

  if (reportId === "employee-transcript") {
    const employee = d.employee as Record<string, unknown> | undefined;
    const trainingRecords = (d.trainingRecords as Array<Record<string, unknown>>) ?? [];
    const empName = employee ? `${employee.firstName} ${employee.lastName}` : "Unknown";
    const headers = ["Training Type", "Completion Date", "Due Date", "Status", "Trainer", "Notes"];
    const rows = trainingRecords.map(r => [
      String(r.trainingTypeName ?? ""),
      String(r.completionDate ?? ""),
      String(r.dueDate ?? ""),
      String(r.status ?? ""),
      String(r.trainerName ?? ""),
      String(r.notes ?? ""),
    ]);
    return [
      ["Employee", empName],
      [],
      headers,
      ...rows.length ? rows : [["No training records found"]],
    ];
  }

  const records = (
    (d.records as unknown[]) ??
    (d.trainingRecords as unknown[]) ??
    (d.employees as unknown[]) ??
    (d.data as unknown[]) ??
    []
  ) as Array<Record<string, unknown>>;

  if (records.length === 0) return [["No data available"]];
  const headers = Object.keys(records[0]).filter(k => k !== "trainingType");
  const rows = records.map(r => headers.map(h => {
    const val = r[h];
    if (val === null || val === undefined) return "";
    return String(val);
  }));
  return [headers, ...rows];
}

function toCsv(rows: string[][]): string {
  return rows.map(row =>
    row.map(cell => {
      const str = String(cell ?? "");
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(",")
  ).join("\n");
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
  const { data: facilities } = useListFacilities({});
  const { toast } = useToast();
  const { user } = useAuth();

  const visibleReports = ALL_REPORTS.filter(r => {
    if (r.roles && !r.roles.includes(user?.role ?? "")) return false;
    if (category !== "All" && r.category !== category) return false;
    if (search) {
      const s = search.toLowerCase();
      return r.title.toLowerCase().includes(s) || r.description.toLowerCase().includes(s) || r.category.toLowerCase().includes(s);
    }
    return true;
  });

  const runReport = async (report: ReportDef) => {
    setLoadingReport(report.id);
    try {
      const params = new URLSearchParams();
      if (facilityId && facilityId !== "all") params.set("facilityId", facilityId);

      const res = await fetch(`/api/reports/${report.id}?${params}`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      const rows = flattenToRows(data, report.id);
      const csv = toCsv(rows);
      const timestamp = new Date().toISOString().split("T")[0];
      downloadCsv(csv, `${report.id}-${timestamp}.csv`);
      toast({ title: `${report.title} exported` });
    } catch (err) {
      toast({ title: "Export failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setLoadingReport(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Compliance Reports</h1>
          <p className="text-muted-foreground">Generate and export compliance reports for your organization.</p>
        </div>
        <Select value={facilityId} onValueChange={setFacilityId}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="All Facilities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Facilities</SelectItem>
            {facilities?.map(f => (
              <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search reports..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map(c => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="text-sm text-muted-foreground">
        {visibleReports.length} report{visibleReports.length !== 1 ? "s" : ""} available
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {visibleReports.map(report => {
          const Icon = report.icon;
          const isLoading = loadingReport === report.id;
          return (
            <Card key={report.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <CardTitle className="text-base leading-tight">{report.title}</CardTitle>
                    <Badge variant="outline" className="text-xs mt-1">{report.category}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-3">{report.description}</p>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground truncate mr-2">Ref: {report.requiredBy}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isLoading}
                    onClick={() => runReport(report)}
                    className="shrink-0"
                  >
                    <Download className="mr-2 h-3.5 w-3.5" />
                    {isLoading ? "Exporting..." : "Export CSV"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {visibleReports.length === 0 && (
          <div className="col-span-2 text-center py-12 text-muted-foreground">
            No reports match your search.
          </div>
        )}
      </div>
    </div>
  );
}
