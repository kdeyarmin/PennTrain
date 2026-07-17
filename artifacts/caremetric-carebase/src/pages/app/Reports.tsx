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
import { useListFacilities } from "@/hooks/useFacilities";
import { formatDateForDisplay, toLocalIsoDate } from "@/lib/dateUtils";
import { escapeOrValue } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { ReportViewer } from "@/components/reports/ReportViewer";
import {
  useDeleteReportView,
  useListSavedReportViews,
  useSaveReportView,
} from "@/hooks/useSavedReports";
import {
  buildSavedViewFilters,
  parseSavedViewFilters,
  reportCategoryToDomain,
  type SavedReportViewConfig,
} from "@/lib/savedReportViews";
import type { LucideIcon } from "lucide-react";
import {
  Bookmark,
  BookmarkPlus,
  Trash2,
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

interface PagedReportData extends ParsedReport {
  generatedAt: string;
  totalRows: number;
  pageSize: number;
  pageOffset: number;
  hasMore: boolean;
}

interface ActiveReportRequest {
  report: ReportDef;
  employeeId?: string;
  dateFrom?: string;
  dateTo?: string;
}

const REPORT_DATE_FIELD_LABEL: Record<string, string | null> = {
  "compliance-summary": "Due Date",
  "facility-compliance": "Due Date",
  "survey-readiness": "Due Date",
  "expired-training": "Due Date",
  "due-soon": "Due Date",
  "medication-administration": "Due Date",
  "training-matrix": null,
  "practicum-status": "Due Date",
  "annual-practicum": "Due Date",
  "annual-hours": "Training Year",
  "training-hours": "Training Year",
  "trainer-certification": "Due Date",
  "new-employee-training": "Due Date",
  "employee-transcript": "Due Date",
  "expiring-certifications": "Due Date",
  "missing-documents": "Due Date",
  "document-audit": "Document Upload Date",
  "overdue-training": "Due Date",
  "credential-status": "Expiration Date",
  "incident-log": "Occurred Date",
  "incident-notification-register": "Notification Due Date",
  "inspection-compliance": "Next Due Date",
};

// Item 3: reports excluded from the automatic "default to a recent window" behavior (below)
// even though they otherwise support date filtering. `annual-hours` already has its own more
// precise current-training-year default in the database report engine; injecting a second,
// competing default here would
// silently widen it and make View and CSV disagree whenever both fields are left blank.
// `employee-transcript`'s own card explicitly promises "Complete training transcript ... all
// training history" for one person -- inherently small (a career's worth of records, not
// "thousands of rows"), so bounding it by default would contradict what it says it is, for no
// rendering benefit.
const SKIP_AUTO_DATE_DEFAULT = new Set<string>(["annual-hours", "employee-transcript"]);

function supportsAutoDateDefault(reportId: string): boolean {
  return Boolean(REPORT_DATE_FIELD_LABEL[reportId]) && !SKIP_AUTO_DATE_DEFAULT.has(reportId);
}

// Item 3: the bounded window a View (not CSV -- see exportCsv call sites) falls back to when
// both date fields are left empty, instead of rendering a multi-year org's full history into
// ReportViewer's plain, uncapped table. Weighted mostly toward the past (matching how most
// reports read: due/expired/occurred dates), but with a forward buffer too: "Training Due Soon"
// and "Expiring Certifications" filter for dates in the *next* 90 days, and a purely backward
// window would silently zero those reports out by default.
function defaultDateWindow(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now);
  from.setMonth(from.getMonth() - 12);
  const to = new Date(now);
  to.setMonth(to.getMonth() + 6);
  return { from: toLocalIsoDate(from), to: toLocalIsoDate(to) };
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

function parsePagedReport(value: unknown): PagedReportData {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The report service returned an invalid response.");
  }
  const result = value as Record<string, unknown>;
  const headers = Array.isArray(result.headers) ? result.headers.map(String) : null;
  const rows = Array.isArray(result.rows)
    ? result.rows.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : null))
    : null;
  const summaryCards = Array.isArray(result.summaryCards) ? result.summaryCards : null;
  if (!headers || !rows || rows.some((row) => row === null) || !summaryCards) {
    throw new Error("The report service returned an invalid response.");
  }
  return {
    headers,
    rows: rows as string[][],
    summaryCards: summaryCards as SummaryCard[],
    generatedAt: typeof result.generatedAt === "string" ? result.generatedAt : new Date().toISOString(),
    totalRows: Number(result.totalRows ?? rows.length),
    pageSize: Number(result.pageSize ?? rows.length),
    pageOffset: Number(result.pageOffset ?? 0),
    hasMore: result.hasMore === true,
  };
}

async function requestReportPage(
  report: ReportDef,
  options: {
    facilityId: string;
    employeeId?: string;
    dateFrom?: string;
    dateTo?: string;
    limit: number;
    offset: number;
  },
): Promise<PagedReportData> {
  const { data, error } = await supabase.rpc("generate_paged_compliance_report", {
    p_report_id: report.id,
    p_facility_id: options.facilityId === "all" ? undefined : options.facilityId,
    p_employee_id: options.employeeId,
    p_date_from: options.dateFrom || undefined,
    p_date_to: options.dateTo || undefined,
    p_limit: options.limit,
    p_offset: options.offset,
  });
  if (error) throw error;
  return parsePagedReport(data);
}

export default function Reports() {
  const [facilityId, setFacilityId] = useState<string>("all");
  const [category, setCategory] = useState<string>("All");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [payPeriodStart, setPayPeriodStart] = useState(() => {
    const date = new Date(); date.setDate(date.getDate() - 13); return toLocalIsoDate(date);
  });
  const [payPeriodEnd, setPayPeriodEnd] = useState(() => toLocalIsoDate());
  const [exportingPayroll, setExportingPayroll] = useState(false);
  const [pendingReport, setPendingReport] = useState<ReportDef | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("none");
  const [employeeSearch, setEmployeeSearch] = useState("");
  // The report the shared date-range control (and the per-report query gating below) currently
  // pertains to. Defaults to the first report so the "Filtering by:" label and dataset fetching
  // have a sensible starting point before the user has clicked anything. Changing it always
  // clears dateFrom/dateTo (see selectReport) so a range typed in for one field never silently
  // carries over onto a differently-named field on a different report.
  const [selectedReportId, setSelectedReportId] = useState<string>(ALL_REPORTS[0].id);
  const [activeReport, setActiveReport] = useState<ReportDef | null>(null);
  const [activeReportRequest, setActiveReportRequest] = useState<ActiveReportRequest | null>(null);
  const [reportData, setReportData] = useState<PagedReportData | null>(null);
  const [reportLoadingId, setReportLoadingId] = useState<string | null>(null);
  const [exportingReportId, setExportingReportId] = useState<string | null>(null);

  const { toast } = useToast();
  const { user } = useAuth();

  // Saved report views: named, versioned report configurations stored on the Phase 5
  // saved-reports schema and shared org-wide (RLS-scoped reads; RPC-guarded writes).
  const [showSaveView, setShowSaveView] = useState(false);
  const [saveViewName, setSaveViewName] = useState("");
  const { data: savedViewDefinitions } = useListSavedReportViews();
  const { mutate: saveView, isPending: savingView } = useSaveReportView();
  const { mutate: deleteView } = useDeleteReportView();
  const canManageViews = ["org_admin", "facility_manager"].includes(user?.role ?? "");
  const savedViews = (savedViewDefinitions ?? [])
    .map((definition) => ({ definition, config: parseSavedViewFilters(definition.current_version?.filters) }))
    .filter((entry): entry is { definition: (typeof entry)["definition"]; config: SavedReportViewConfig } => !!entry.config);

  // Facilities always fetch: the facility picker below and the "Filtered to X" label are
  // page-level chrome, not tied to any single report.
  const facilitiesQuery = useListFacilities({});
  const employeePickerQuery = useQuery({
    queryKey: ["report-employee-picker", facilityId, employeeSearch],
    enabled: !!pendingReport,
    queryFn: async () => {
      let query = supabase
        .from("employees")
        .select("id, first_name, last_name, job_title")
        .eq("status", "active")
        .eq("is_synthetic", false)
        .order("last_name")
        .order("first_name")
        .limit(50);
      if (facilityId !== "all") query = query.eq("facility_id", facilityId);
      const term = employeeSearch.trim();
      if (term) {
        const pattern = escapeOrValue(`%${term}%`);
        query = query.or(
          `first_name.ilike.${pattern},last_name.ilike.${pattern},employee_number.ilike.${pattern}`,
        );
      }
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });

  const facilities = (facilitiesQuery.data ?? []).filter((facility) => !facility.is_sandbox);
  const facilityName = facilityId !== "all" ? facilities.find((facility) => facility.id === facilityId)?.name : undefined;
  const retentionQuery = useQuery({
    queryKey: ["workforce-retention-metrics", facilityId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_workforce_retention_metrics", {
        p_facility_id: facilityId === "all" ? undefined : facilityId,
      });
      if (error) throw error;
      return data as { segments?: Array<{ role: string; annualizedTurnoverRate: number | null; ninetyDayRetentionRate: number | null; averageTenureDays: number | null; currentHeadcount: number }> };
    },
  });
  const retentionTotal = retentionQuery.data?.segments?.find((segment) => segment.role === "All roles");

  const exportPaidTrainingPayroll = async () => {
    if (facilityId === "all") {
      toast({ title: "Select one facility for a payroll export", variant: "destructive" });
      return;
    }
    setExportingPayroll(true);
    try {
      const { data, error } = await supabase.rpc("get_paid_training_payroll_export", {
        p_facility_id: facilityId, p_period_start: payPeriodStart, p_period_end: payPeriodEnd,
      });
      if (error) throw error;
      const rows = (data ?? []).map((row) => [
        row.employee_number ?? "", row.employee_name, row.work_date, row.course_or_class,
        row.training_code, String(row.verified_hours), row.source,
      ]);
      downloadCsv(toCsv(["Employee Number","Employee","Work Date","Course/Class","Training Code","Verified Hours","Source"], rows),
        `paid-training-payroll-${payPeriodStart}-${payPeriodEnd}.csv`);
      void supabase.functions.invoke("capture-product-event", { body: { eventName: "payroll_exported", route: "/app/reports", properties: { count: rows.length, surface: "reports" } } });
      toast({ title: "Paid training payroll CSV exported", description: `${rows.length} verified training row(s).` });
    } catch (error) {
      toast({ title: "Payroll export failed", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally { setExportingPayroll(false); }
  };

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

  // Item 1b/1c: what the shared date-range control above shows/does right now, derived from
  // whichever report is currently selected (see selectReport / REPORT_DATE_FIELD_LABEL).
  const selectedReportForLabel = ALL_REPORTS.find((r) => r.id === selectedReportId);
  const dateFieldLabel = REPORT_DATE_FIELD_LABEL[selectedReportId];

  const pendingReportDataReady = !!pendingReport && !employeePickerQuery.isLoading;

  // Item 1a: switching which report the date-range control applies to always clears it, so a
  // range typed in for one field (e.g. due_date) never silently carries over and gets read as a
  // filter on a differently-named field (e.g. occurred_at) for the next report. Returns whether
  // the selection actually changed, so callers know whether the reset applies to their own
  // in-flight click.
  const selectReport = useCallback(
    (reportId: string): boolean => {
      if (reportId === selectedReportId) return false;
      setSelectedReportId(reportId);
      setDateFrom("");
      setDateTo("");
      return true;
    },
    [selectedReportId]
  );

  const viewReport = useCallback(
    async (
      report: ReportDef,
      employeeIdOverride?: string,
      dateFromOverride?: string,
      dateToOverride?: string,
      pageOffset = 0,
    ) => {
      setReportLoadingId(report.id);
      try {
        const effectiveFrom = (dateFromOverride !== undefined ? dateFromOverride : dateFrom) || undefined;
        const effectiveTo = (dateToOverride !== undefined ? dateToOverride : dateTo) || undefined;
        const parsed = await requestReportPage(report, {
          facilityId,
          employeeId: employeeIdOverride,
          dateFrom: effectiveFrom,
          dateTo: effectiveTo,
          limit: 100,
          offset: pageOffset,
        });
        setActiveReport(report);
        setActiveReportRequest({ report, employeeId: employeeIdOverride, dateFrom: effectiveFrom, dateTo: effectiveTo });
        setReportData(parsed);
        setPendingReport(null);
      } catch (err) {
        toast({
          title: "Failed to generate report",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
      } finally {
        setReportLoadingId(null);
      }
    },
    [dateFrom, dateTo, facilityId, toast]
  );

  const exportCsv = useCallback(
    async (report: ReportDef, employeeIdOverride?: string, dateFromOverride?: string, dateToOverride?: string) => {
      setExportingReportId(report.id);
      try {
        const effectiveFrom = (dateFromOverride !== undefined ? dateFromOverride : dateFrom) || undefined;
        const effectiveTo = (dateToOverride !== undefined ? dateToOverride : dateTo) || undefined;
        const rows: string[][] = [];
        let headers: string[] = [];
        let offset = 0;
        let totalRows = 0;
        do {
          const page = await requestReportPage(report, {
            facilityId,
            employeeId: employeeIdOverride,
            dateFrom: effectiveFrom,
            dateTo: effectiveTo,
            limit: 1000,
            offset,
          });
          if (headers.length === 0) headers = page.headers;
          rows.push(...page.rows);
          totalRows = page.totalRows;
          offset += page.rows.length;
          if (page.rows.length === 0) break;
        } while (offset < totalRows);

        const csv = toCsv(headers, rows);
        const timestamp = new Date().toISOString().split("T")[0];
        downloadCsv(csv, `${report.id}-${timestamp}.csv`);
        toast({ title: `${report.title} exported`, description: `${rows.length} row(s) exported from bounded server pages.` });
        setPendingReport(null);
      } catch (err) {
        toast({
          title: "Export failed",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
      } finally {
        setExportingReportId(null);
      }
    },
    [dateFrom, dateTo, facilityId, toast]
  );

  const handleSaveCurrentView = () => {
    const report = ALL_REPORTS.find((r) => r.id === selectedReportId);
    if (!report) return;
    saveView(
      {
        name: saveViewName.trim(),
        reportType: reportCategoryToDomain(report.category),
        filters: buildSavedViewFilters({ reportId: report.id, facilityId, dateFrom, dateTo }),
      },
      {
        onSuccess: () => {
          toast({ title: "View saved", description: "It now appears in Saved Views for your organization." });
          setShowSaveView(false);
          setSaveViewName("");
        },
        onError: (e: Error) => toast({ title: "Couldn't save view", description: e.message, variant: "destructive" }),
      },
    );
  };

  const runSavedView = (config: SavedReportViewConfig) => {
    const report = ALL_REPORTS.find((r) => r.id === config.reportId);
    if (!report) {
      toast({ title: "This saved view references a report that no longer exists", variant: "destructive" });
      return;
    }
    setFacilityId(config.facilityId ?? "all");
    selectReport(report.id);
    const effFrom = config.dateFrom ?? "";
    const effTo = config.dateTo ?? "";
    setDateFrom(effFrom);
    setDateTo(effTo);
    if (report.requiresEmployee) {
      setSelectedEmployeeId("none");
      setEmployeeSearch("");
      setPendingReport(report);
      return;
    }
    void viewReport(report, undefined, effFrom, effTo);
  };

  const handleDeleteView = (definitionId: string, name: string) => {
    deleteView(definitionId, {
      onSuccess: () => toast({ title: `Deleted saved view "${name}"` }),
      onError: (e: Error) => toast({ title: "Couldn't delete view", description: e.message, variant: "destructive" }),
    });
  };

  const handleReportAction = (report: ReportDef, action: "view" | "csv") => {
    const isNewSelection = selectReport(report.id);
    let effFrom = isNewSelection ? "" : dateFrom;
    let effTo = isNewSelection ? "" : dateTo;

    // Item 3: only View gets the bounded default when both fields are empty -- CSV is left
    // alone so clearing the fields on purpose still produces a genuine "all time" export. The
    // From/To inputs are deliberately *not* updated to show this window (setDateFrom/setDateTo
    // are never called here): leaving them empty is what keeps CSV "all time by default" after
    // a View. A toast instead says out loud what got applied, so this fix doesn't just trade one
    // silent date filter for another.
    if (action === "view" && !effFrom && !effTo && supportsAutoDateDefault(report.id)) {
      const dateWindow = defaultDateWindow();
      effFrom = dateWindow.from;
      effTo = dateWindow.to;
      const fmt = (d: string) => formatDateForDisplay(d, { month: "short", day: "numeric", year: "numeric" });
      toast({
        title: "Showing recent data only",
        description: `No date range was set, so ${report.title} is limited to ${fmt(effFrom)} – ${fmt(effTo)}. Set the From/To fields above for a different range, or use CSV export for all-time data.`,
      });
    }

    if (report.requiresEmployee) {
      setSelectedEmployeeId("none");
      setEmployeeSearch("");
      setPendingReport(report);
      return;
    }

    if (action === "view") void viewReport(report, undefined, effFrom, effTo);
    else void exportCsv(report, undefined, effFrom, effTo);
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
    setActiveReportRequest(null);
    setReportData(null);
  };

  const handleExportCurrentCsv = () => {
    if (!activeReportRequest) return;
    void exportCsv(
      activeReportRequest.report,
      activeReportRequest.employeeId,
      activeReportRequest.dateFrom,
      activeReportRequest.dateTo,
    );
  };

  const handleReportPageChange = (nextOffset: number) => {
    if (!activeReportRequest) return;
    void viewReport(
      activeReportRequest.report,
      activeReportRequest.employeeId,
      activeReportRequest.dateFrom,
      activeReportRequest.dateTo,
      nextOffset,
    );
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
          totalRows={reportData.totalRows}
          pageSize={reportData.pageSize}
          pageOffset={reportData.pageOffset}
          isPageLoading={reportLoadingId === activeReport.id}
          isExporting={exportingReportId === activeReport.id}
          onPageChange={handleReportPageChange}
          onClose={handleCloseViewer}
          onExportCsv={handleExportCurrentCsv}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
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
          <SelectTrigger className="w-full sm:w-52">
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" /> Workforce analytics and payroll</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div><p className="text-2xl font-bold">{retentionTotal?.annualizedTurnoverRate ?? "--"}{retentionTotal?.annualizedTurnoverRate != null ? "%" : ""}</p><p className="text-xs text-muted-foreground">annualized turnover</p></div>
            <div><p className="text-2xl font-bold">{retentionTotal?.ninetyDayRetentionRate ?? "--"}{retentionTotal?.ninetyDayRetentionRate != null ? "%" : ""}</p><p className="text-xs text-muted-foreground">90-day retention</p></div>
            <div><p className="text-2xl font-bold">{retentionTotal?.averageTenureDays ?? "--"}</p><p className="text-xs text-muted-foreground">average tenure days</p></div>
            <div><p className="text-2xl font-bold">{retentionTotal?.currentHeadcount ?? "--"}</p><p className="text-xs text-muted-foreground">current headcount</p></div>
          </div>
          <p className="text-xs text-muted-foreground">Turnover uses trailing-12-month separations divided by average starting/current headcount. Select a facility above for facility-level results; role segments are included in the underlying report response.</p>
          <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div><Label htmlFor="payroll-from">Pay period start</Label><Input id="payroll-from" type="date" value={payPeriodStart} onChange={(event) => setPayPeriodStart(event.target.value)} /></div>
            <div><Label htmlFor="payroll-to">Pay period end</Label><Input id="payroll-to" type="date" value={payPeriodEnd} onChange={(event) => setPayPeriodEnd(event.target.value)} /></div>
            <Button onClick={() => void exportPaidTrainingPayroll()} disabled={exportingPayroll || facilityId === "all" || !payPeriodStart || !payPeriodEnd}>
              {exportingPayroll ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />} Export paid training CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="rounded-xl border border-border/60 bg-card p-3 shadow-sm sm:p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
          <div className="relative sm:col-span-2 lg:min-w-64 lg:flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search reports..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 pl-9"
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
          <SelectTrigger className="h-10 w-full md:hidden">
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
        <div className="grid gap-1.5">
          <Label htmlFor="report-date-from" className="text-xs text-muted-foreground">
            From
          </Label>
          <Input
            id="report-date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            disabled={!dateFieldLabel}
            className="h-10 w-full lg:w-40"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="report-date-to" className="text-xs text-muted-foreground">
            To
          </Label>
          <Input
            id="report-date-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            disabled={!dateFieldLabel}
            className="h-10 w-full lg:w-40"
          />
        </div>
        {dateFieldLabel ? (
          <span className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-1">
            Filtering by: <strong className="font-medium text-foreground">{dateFieldLabel}</strong>
          </span>
        ) : (
          <span className="text-xs italic text-muted-foreground sm:col-span-2 lg:col-span-1">
            {selectedReportForLabel?.title ?? "This report"} doesn't support date filtering
          </span>
        )}
        {(dateFrom || dateTo) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-10 justify-center text-xs text-muted-foreground"
            onClick={() => {
              setDateFrom("");
              setDateTo("");
            }}
          >
            Clear dates
          </Button>
        )}
        {canManageViews && (
          <Button variant="outline" size="sm" className="h-10 justify-center text-xs sm:col-span-2 lg:col-span-1" onClick={() => setShowSaveView(true)}>
            <BookmarkPlus className="mr-1.5 h-3.5 w-3.5" />
            Save view
          </Button>
        )}
        </div>
      </div>

      {savedViews.length > 0 && (
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Bookmark className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Saved Views</h3>
            <span className="text-xs text-muted-foreground">
              One-click report configurations shared with your organization.
            </span>
          </div>
          <div className="grid gap-2 sm:flex sm:flex-wrap">
            {savedViews.map(({ definition, config }) => (
              <div key={definition.id} className="flex items-center justify-between gap-2 rounded-lg border py-2 pl-3 pr-1">
                <button
                  type="button"
                  className="min-w-0 truncate text-left text-sm font-medium transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => runSavedView(config)}
                >
                  {definition.name}
                </button>
                {(user?.role === "org_admin" || definition.owner_profile_id === user?.id) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDeleteView(definition.id, definition.name)}
                    aria-label={`Delete saved view ${definition.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog open={showSaveView} onOpenChange={(o) => { if (!o) setShowSaveView(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Save current view</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Saves "{ALL_REPORTS.find((r) => r.id === selectedReportId)?.title ?? "the selected report"}" with the
              current facility and date range as a one-click view shared with your organization. Saving the same
              name again publishes a new version of the view.
            </p>
            <div className="space-y-1.5">
              <Label className="text-[13px]">View name</Label>
              <Input
                value={saveViewName}
                onChange={(e) => setSaveViewName(e.target.value)}
                placeholder="e.g. Weekly expired training"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveView(false)}>Cancel</Button>
            <Button onClick={handleSaveCurrentView} disabled={savingView || saveViewName.trim().length < 3}>
              {savingView ? "Saving..." : "Save View"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
        {reportLoadingId === selectedReportId && <span className="ml-2 text-xs">(generating report page…)</span>}
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
          const isSelected = report.id === selectedReportId;
          const cardBusy = reportLoadingId === report.id || exportingReportId === report.id;
          return (
            <Card
              key={report.id}
              tabIndex={0}
              role="button"
              aria-pressed={isSelected}
              aria-label={`Select ${report.title} report`}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  selectReport(report.id);
                }
              }}
              className={`group flex cursor-pointer flex-col border-l-4 ${colors.border} transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isSelected ? "ring-2 ring-primary" : ""}`}
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
                    <div className="mt-2 flex flex-wrap items-center gap-2">
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
                <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                  <Button
                    size="sm"
                    variant="default"
                    disabled={cardBusy}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleReportAction(report, "view");
                    }}
                    className="flex-1"
                  >
                    {cardBusy ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                      <Eye className="h-3.5 w-3.5 mr-1" />
                    )}
                    View
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={cardBusy}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleReportAction(report, "csv");
                    }}
                  >
                    {exportingReportId === report.id ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5 mr-1" />
                    )}
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
              Search and select the employee for this report. Results are limited to the first 50 matches.
            </p>
            <div className="space-y-2">
              <Label htmlFor="emp-search">Find employee</Label>
              <Input
                id="emp-search"
                value={employeeSearch}
                onChange={(event) => setEmployeeSearch(event.target.value)}
                placeholder="Search by name or employee number"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="emp-select">Employee</Label>
              <Select
                value={selectedEmployeeId}
                onValueChange={setSelectedEmployeeId}
                disabled={employeePickerQuery.isLoading}
              >
                <SelectTrigger id="emp-select">
                  <SelectValue placeholder={employeePickerQuery.isLoading ? "Loading employees…" : "Select an employee..."} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Select an employee...</SelectItem>
                  {(employeePickerQuery.data ?? []).map((e) => (
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
              disabled={selectedEmployeeId === "none" || !pendingReportDataReady || exportingReportId === pendingReport?.id}
            >
              {exportingReportId === pendingReport?.id ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              CSV
            </Button>
            <Button
              onClick={() => handleEmployeeReportAction("view")}
              disabled={selectedEmployeeId === "none" || !pendingReportDataReady || reportLoadingId === pendingReport?.id}
            >
              {!pendingReportDataReady || reportLoadingId === pendingReport?.id ? (
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
