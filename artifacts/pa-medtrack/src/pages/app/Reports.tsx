import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useListFacilities } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import {
  FileText, Users, Building2, Clock, AlertTriangle,
  GraduationCap, Files, CheckCircle, Download, Shield
} from "lucide-react";
import { LucideIcon } from "lucide-react";

interface ReportDef {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  category: string;
  requiredBy: string;
}

const REPORTS: ReportDef[] = [
  {
    id: "medication-administration",
    title: "Medication Administration Training",
    description: "Track initial and recertification training for all staff who administer medications.",
    icon: FileText,
    category: "Training",
    requiredBy: "28 Pa. Code §2600.77",
  },
  {
    id: "annual-practicum",
    title: "Annual Practicum Status",
    description: "View completion status of required annual medication administration practicums.",
    icon: CheckCircle,
    category: "Practicum",
    requiredBy: "28 Pa. Code §2600.78",
  },
  {
    id: "training-hours",
    title: "Annual Training Hours",
    description: "Report on 12-hour annual training requirements for PCH and ALR staff.",
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
    description: "View all certifications expiring within the next 90 days.",
    icon: AlertTriangle,
    category: "Alerts",
    requiredBy: "Internal Compliance",
  },
  {
    id: "overdue-training",
    title: "Overdue Training",
    description: "Report on all expired or overdue training requirements across the organization.",
    icon: AlertTriangle,
    category: "Compliance",
    requiredBy: "Internal Compliance",
  },
  {
    id: "new-employee-training",
    title: "New Employee Training",
    description: "Track training completion for recently hired staff within their first 90 days.",
    icon: Users,
    category: "Onboarding",
    requiredBy: "28 Pa. Code §2600.77",
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
    description: "Comprehensive readiness assessment for state survey inspections.",
    icon: Shield,
    category: "Survey",
    requiredBy: "DHS Survey Preparation",
  },
];

function flattenToRows(data: unknown, reportId: string): string[][] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;

  if (reportId === "facility-compliance") {
    const facilities = (d.facilities as Array<Record<string, unknown>>) ?? [];
    const headers = ["Facility", "Type", "Total Records", "Compliant", "Expired", "Due Soon", "Compliance Score"];
    const rows = facilities.map(f => [
      String(f.facilityName ?? ""),
      String(f.facilityType ?? ""),
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
    return [headers, ...rows];
  }

  if (reportId === "training-hours") {
    const buckets = (d.buckets as Array<Record<string, unknown>>) ?? [];
    const headers = ["Employee ID", "Year", "Required Hours", "Completed Hours", "Status"];
    const rows = buckets.map(b => [
      String(b.employeeId ?? ""),
      String(b.trainingYear ?? ""),
      String(b.requiredHours ?? ""),
      String(b.completedHours ?? ""),
      String(b.status ?? ""),
    ]);
    return [headers, ...rows];
  }

  // Default for record-based reports
  const records = (
    (d.records as unknown[]) ??
    (d.trainingRecords as unknown[]) ??
    (d.employees as unknown[]) ??
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
  const [loadingReport, setLoadingReport] = useState<string | null>(null);
  const { data: facilities } = useListFacilities({});
  const { toast } = useToast();

  const runReport = async (report: ReportDef) => {
    setLoadingReport(report.id);
    try {
      const params = new URLSearchParams();
      if (facilityId && facilityId !== "all") params.set("facilityId", facilityId);

      const res = await fetch(`/api/reports/${report.id}?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Report failed");
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
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-muted-foreground">Filter by facility:</label>
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
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {REPORTS.map(report => {
          const Icon = report.icon;
          const isLoading = loadingReport === report.id;
          return (
            <Card key={report.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{report.title}</CardTitle>
                      <Badge variant="outline" className="text-xs mt-1">{report.category}</Badge>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-3">{report.description}</p>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Ref: {report.requiredBy}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isLoading}
                    onClick={() => runReport(report)}
                  >
                    <Download className="mr-2 h-3.5 w-3.5" />
                    {isLoading ? "Exporting..." : "Export CSV"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
