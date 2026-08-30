import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Download,
  Search,
  Syringe,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QueryError } from "@/components/QueryState";
import { supabase } from "@/lib/supabase";
import { csvEscape } from "@/lib/csv";
import { downloadCsvText } from "@/lib/browserDownload";
import { facilityToday } from "@/lib/dateUtils";
import { useToast } from "@/hooks/use-toast";
import {
  DIABETES_COURSE_CITATION,
  DIABETES_COURSE_SHORT_TITLE,
} from "@/hooks/useDiabetesTraining";

const PAGE_SIZE = 25;

/** Mirrors the compliance_status values generate_diabetes_training_compliance_report emits. */
const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "current", label: "Current" },
  { value: "due_soon", label: "Due within 60 days" },
  { value: "urgent", label: "Due within 14 days" },
  { value: "expired", label: "Expired" },
  { value: "not_started", label: "Assigned, not started" },
  { value: "in_progress", label: "In progress" },
  { value: "exam_not_passed", label: "Exam not yet passed" },
  { value: "completed", label: "Completed" },
];

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  current: "default",
  "due soon": "outline",
  urgent: "outline",
  expired: "destructive",
  "not started": "secondary",
  "in progress": "secondary",
  "exam not passed": "destructive",
};

interface ReportPage {
  headers: string[];
  rows: string[][];
  summaryCards: { label: string; value: number | string; variant?: string }[];
  totalRows: number;
  hasMore: boolean;
}

function parseReportPage(value: unknown): ReportPage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The report service returned an invalid response.");
  }
  const result = value as Record<string, unknown>;
  const headers = Array.isArray(result.headers) ? result.headers.map(String) : null;
  const rows = Array.isArray(result.rows)
    ? result.rows.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : null))
    : null;
  if (!headers || !rows || rows.some((row) => row === null)) {
    throw new Error("The report service returned an invalid response.");
  }
  return {
    headers,
    rows: rows as string[][],
    summaryCards: Array.isArray(result.summaryCards)
      ? (result.summaryCards as ReportPage["summaryCards"])
      : [],
    totalRows: Number(result.totalRows ?? rows.length),
    hasMore: result.hasMore === true,
  };
}

async function fetchPage(options: {
  facilityId: string;
  status: string;
  search: string;
  limit: number;
  offset: number;
}): Promise<ReportPage> {
  const { data, error } = await supabase.rpc("generate_diabetes_training_compliance_report", {
    p_facility_id: options.facilityId === "all" ? undefined : options.facilityId,
    p_status: options.status === "all" ? undefined : options.status,
    p_search: options.search.trim() || undefined,
    p_limit: options.limit,
    p_offset: options.offset,
  });
  if (error) throw error;
  return parseReportPage(data);
}

/**
 * Annual diabetes education compliance, on the training dashboard rather than in a separate tool.
 *
 * The rows come from the same RPC the PA PCH Diabetes Training Compliance Report exports, so an
 * administrator sees on screen exactly what an inspector receives as a file. Sorting is applied to
 * the page in view; the export walks every server page so a filtered CSV is complete rather than
 * just the rows currently rendered.
 */
export function DiabetesEducationComplianceCard({ facilityId }: { facilityId: string }) {
  const { toast } = useToast();
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [sortColumn, setSortColumn] = useState<number | null>(null);
  const [sortDescending, setSortDescending] = useState(false);
  const [exporting, setExporting] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["diabetes_compliance_report", facilityId, status, search, page],
    queryFn: () =>
      fetchPage({ facilityId, status, search, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
  });

  const sortedRows = useMemo(() => {
    const rows = data?.rows ?? [];
    if (sortColumn === null) return rows;
    return rows.slice().sort((a, b) => {
      const left = a[sortColumn] ?? "";
      const right = b[sortColumn] ?? "";
      const comparison = left.localeCompare(right, undefined, { numeric: true });
      return sortDescending ? -comparison : comparison;
    });
  }, [data?.rows, sortColumn, sortDescending]);

  const toggleSort = (index: number) => {
    if (sortColumn === index) {
      setSortDescending((previous) => !previous);
      return;
    }
    setSortColumn(index);
    setSortDescending(false);
  };

  const resetPaging = () => setPage(0);

  const handleExport = async () => {
    setExporting(true);
    try {
      const collected: string[][] = [];
      let headers: string[] = [];
      let offset = 0;
      // Walk every server page: an export that only contained the rows on screen would quietly
      // under-report, which is the one thing an inspection export must not do.
      for (;;) {
        const chunk = await fetchPage({ facilityId, status, search, limit: 1000, offset });
        if (headers.length === 0) headers = chunk.headers;
        collected.push(...chunk.rows);
        if (chunk.rows.length === 0 || collected.length >= chunk.totalRows) break;
        offset += chunk.rows.length;
      }
      const csv = [headers, ...collected].map((row) => row.map(csvEscape).join(",")).join("\n");
      downloadCsvText(`pa-pch-diabetes-training-compliance-${facilityToday()}.csv`, csv);
      toast({
        title: "Diabetes training compliance exported",
        description: `${collected.length} row(s) exported.`,
      });
    } catch (exportError) {
      toast({
        title: "Export failed",
        description: exportError instanceof Error ? exportError.message : String(exportError),
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  const totalRows = data?.totalRows ?? 0;
  const lastPage = Math.max(0, Math.ceil(totalRows / PAGE_SIZE) - 1);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Syringe className="h-5 w-5" />
          {DIABETES_COURSE_SHORT_TITLE}
          <span className="text-sm font-normal text-muted-foreground">
            {DIABETES_COURSE_CITATION} &middot; {totalRows} assigned
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isError ? (
          <QueryError what="diabetes training compliance" error={error} onRetry={() => void refetch()} />
        ) : (
          <>
            {(data?.summaryCards.length ?? 0) > 0 && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {data!.summaryCards.map((card) => (
                  <div key={card.label} className="rounded-lg border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">{card.label}</p>
                    <p className="text-lg font-semibold">{card.value}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <Select
                value={status}
                onValueChange={(value) => { setStatus(value); resetPaging(); }}
              >
                <SelectTrigger className="w-full sm:w-56" aria-label="Diabetes training status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_FILTERS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="relative w-full sm:w-64">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Search employee, number, or facility..."
                  value={search}
                  onChange={(event) => { setSearch(event.target.value); resetPaging(); }}
                  aria-label="Search diabetes training compliance"
                />
              </div>

              <Button
                variant="outline"
                size="sm"
                disabled={exporting}
                onClick={() => void handleExport()}
                className="w-full sm:ml-auto sm:w-auto"
              >
                <Download className="mr-2 h-4 w-4" />
                {exporting ? "Exporting..." : "Export CSV"}
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="border-b text-left">
                    {(data?.headers ?? []).map((header, index) => (
                      <th key={header} className="px-2 py-2 font-medium">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          onClick={() => toggleSort(index)}
                          aria-label={`Sort by ${header}`}
                        >
                          {header}
                          {sortColumn === index
                            ? (sortDescending ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />)
                            : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={14} className="px-2 py-6 text-center text-muted-foreground">Loading...</td></tr>
                  ) : sortedRows.length === 0 ? (
                    <tr>
                      <td colSpan={14} className="px-2 py-6 text-center text-muted-foreground">
                        No employees are assigned this training yet. Assign it from the course to any
                        employee who administers insulin or provides diabetes-related care.
                      </td>
                    </tr>
                  ) : (
                    sortedRows.map((row, rowIndex) => (
                      <tr key={`${row[0]}-${row[10]}-${rowIndex}`} className="border-b last:border-0">
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex} className="px-2 py-2 align-top">
                            {cellIndex === row.length - 1
                              ? <Badge variant={STATUS_VARIANT[cell] ?? "secondary"}>{cell}</Badge>
                              : cell}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {totalRows > PAGE_SIZE && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Page {page + 1} of {lastPage + 1}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= lastPage}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
