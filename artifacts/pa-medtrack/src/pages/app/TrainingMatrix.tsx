import { useState, useMemo } from "react";
import { useListEmployees } from "@/hooks/useEmployees";
import type { Employee } from "@/hooks/useEmployees";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListTrainingTypes } from "@/hooks/useTrainingTypes";
import { useListTrainingRecords, type TrainingRecord } from "@/hooks/useTrainingRecords";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ChevronUp, ChevronDown, ChevronsUpDown, Download, Users, ExternalLink } from "lucide-react";
import { useLocation } from "wouter";

const PAGE_SIZE = 15;

type SortDir = "asc" | "desc";

interface MatrixCell {
  trainingTypeId: string;
  trainingRecordId: string | null;
  status: string;
  completionDate: string | null;
  dueDate: string | null;
  trainerName: string | null;
  hours: number | null;
}

interface MatrixTrainingType {
  id: string;
  code: string;
  name: string;
}

interface MatrixRow {
  employee: Employee;
  cells: MatrixCell[];
}

const STATUS_COLORS: Record<string, string> = {
  compliant: "#22c55e",
  due_soon: "#f59e0b",
  expired: "#ef4444",
  missing: "#94a3b8",
};

// Compliance-bearing statuses, mirroring Dashboard.tsx's computeDashboardSummary convention:
// "not_applicable" and "pending_review" records are excluded from compliance math entirely --
// they aren't yet (or never will be) part of the compliant/non-compliant split.
const RELEVANT_STATUSES = new Set(["compliant", "due_soon", "expired", "missing"]);

// Employees routinely accumulate multiple employee_training_records rows for the same
// training_type_id over time (e.g. complete_training_class() inserts a fresh row each renewal
// cycle rather than updating the prior one). due_date is recalculated server-side as
// completion_date + training_type.renewal_interval_days, so it advances forward each cycle --
// the record with the latest due_date is the current one. Fall back to completion_date, then
// created_at, for cases where due_date ties or is null (e.g. one-time trainings with no
// renewal_interval_days).
function isMoreCurrent(a: TrainingRecord, b: TrainingRecord): boolean {
  const aDue = a.due_date ?? "";
  const bDue = b.due_date ?? "";
  if (aDue !== bDue) return aDue > bDue;
  const aCompletion = a.completion_date ?? "";
  const bCompletion = b.completion_date ?? "";
  if (aCompletion !== bCompletion) return aCompletion > bCompletion;
  return (a.created_at ?? "") > (b.created_at ?? "");
}

function pickCurrentRecord(records: TrainingRecord[]): TrainingRecord | null {
  return records.reduce<TrainingRecord | null>(
    (current, candidate) => (!current || isMoreCurrent(candidate, current) ? candidate : current),
    null,
  );
}

function getStatusColor(status: string | undefined): string {
  if (!status) return STATUS_COLORS.missing;
  return STATUS_COLORS[status] ?? STATUS_COLORS.missing;
}

function getStatusLabel(status: string | undefined): string {
  if (!status) return "No Record";
  switch (status) {
    case "compliant": return "Compliant";
    case "due_soon": return "Due Soon";
    case "expired": return "Expired";
    case "missing": return "No Record";
    default: return status.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
  }
}

function StatusDot({ entry, onClick }: { entry: MatrixCell | undefined; onClick?: () => void }) {
  const color = getStatusColor(entry?.status);
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center w-6 h-6 rounded-full hover:ring-2 hover:ring-offset-1 hover:ring-primary/50 transition-all focus:outline-none focus:ring-2 focus:ring-primary"
      title={getStatusLabel(entry?.status)}
    >
      <span
        style={{
          display: "inline-block",
          width: 12,
          height: 12,
          borderRadius: "50%",
          backgroundColor: color,
        }}
      />
    </button>
  );
}

function SortButton({ field, sortField, sortDir, onSort }: {
  field: string;
  sortField: string;
  sortDir: SortDir;
  onSort: (f: string) => void;
}) {
  const active = sortField === field;
  return (
    <button
      className="ml-1 inline-flex items-center text-muted-foreground hover:text-foreground"
      onClick={() => onSort(field)}
    >
      {active ? (sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : <ChevronsUpDown className="w-3 h-3" />}
    </button>
  );
}

function CellDetailDialog({
  open,
  onClose,
  entry,
  trainingTypeName,
  employeeName,
  employeeId,
}: {
  open: boolean;
  onClose: () => void;
  entry: MatrixCell | null;
  trainingTypeName: string;
  employeeName: string;
  employeeId: string;
}) {
  const [, navigate] = useLocation();

  if (!entry) return null;

  const statusColor = getStatusColor(entry.status);

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{trainingTypeName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">{employeeName}</div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-muted-foreground text-xs mb-1">Status</div>
              <Badge variant="outline" className="gap-1.5">
                <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: statusColor, display: "inline-block" }} />
                {getStatusLabel(entry.status)}
              </Badge>
            </div>
            <div>
              <div className="text-muted-foreground text-xs mb-1">Training Type</div>
              <div>{trainingTypeName}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs mb-1">Last Completed</div>
              <div>{entry.completionDate ? new Date(entry.completionDate).toLocaleDateString() : "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs mb-1">Due Date</div>
              <div>{entry.dueDate ? new Date(entry.dueDate).toLocaleDateString() : "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs mb-1">Trainer</div>
              <div>{entry.trainerName ?? "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs mb-1">Hours</div>
              <div>{entry.hours ?? "—"}</div>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => { onClose(); navigate(`/app/employees/${employeeId}`); }}
          >
            <ExternalLink className="w-3.5 h-3.5 mr-2" />
            View Employee Detail
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function TrainingMatrix() {
  const [facilityId, setFacilityId] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [trainerOnly, setTrainerOnly] = useState(false);
  const [medsOnly, setMedsOnly] = useState(false);
  const [dueWindow, setDueWindow] = useState<string>("all");
  const [sortField, setSortField] = useState<string>("lastName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [selectedCell, setSelectedCell] = useState<{ entry: MatrixCell; trainingTypeName: string; employeeName: string; employeeId: string } | null>(null);

  const { data: facilities } = useListFacilities({});
  const { data: employees } = useListEmployees({
    facilityId: facilityId !== "all" ? facilityId : undefined,
    status: "active",
  });
  const { data: trainingTypes } = useListTrainingTypes({ isActive: true });
  const { data: trainingRecords } = useListTrainingRecords({
    facilityId: facilityId !== "all" ? facilityId : undefined,
  });

  const matrixTrainingTypes: MatrixTrainingType[] = useMemo(
    () => [...(trainingTypes ?? [])].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [trainingTypes],
  );

  const matrixRows: MatrixRow[] = useMemo(() => {
    const emps = employees ?? [];
    const records = trainingRecords ?? [];
    return emps.map(emp => {
      const empRecords = records.filter(r => r.employee_id === emp.id);
      const cells: MatrixCell[] = matrixTrainingTypes.map(tt => {
        const record = pickCurrentRecord(empRecords.filter(r => r.training_type_id === tt.id));
        return {
          trainingTypeId: tt.id,
          trainingRecordId: record?.id ?? null,
          status: record?.status ?? "missing",
          completionDate: record?.completion_date ?? null,
          dueDate: record?.due_date ?? null,
          trainerName: record?.trainer_name ?? null,
          hours: record?.hours ?? null,
        };
      });
      return { employee: emp, cells };
    });
  }, [employees, trainingRecords, matrixTrainingTypes]);

  const getWorstStatus = (row: MatrixRow): string => {
    // Exclude not_applicable/pending_review cells from classification, matching
    // Dashboard.tsx's computeDashboardSummary convention -- those cells aren't part of the
    // compliant/non-compliant split and shouldn't drag a row down to "missing".
    const relevantCells = row.cells.filter(c => RELEVANT_STATUSES.has(c.status));
    if (relevantCells.some(c => c.status === "expired")) return "expired";
    if (relevantCells.some(c => c.status === "missing")) return "missing";
    if (relevantCells.some(c => c.status === "due_soon")) return "due_soon";
    if (relevantCells.length > 0 && relevantCells.every(c => c.status === "compliant")) return "compliant";
    return "compliant";
  };

  const isDueWithinWindow = (row: MatrixRow, days: number): boolean => {
    const now = new Date();
    const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    return row.cells.some(c => {
      if (!c.dueDate) return false;
      const due = new Date(c.dueDate);
      return due >= now && due <= cutoff;
    });
  };

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
    setPage(1);
  };

  const clearFilters = () => {
    setFacilityId("all");
    setSearch("");
    setStatusFilter("all");
    setTrainerOnly(false);
    setMedsOnly(false);
    setDueWindow("all");
    setPage(1);
  };

  const filteredRows = useMemo(() => {
    let rows = [...matrixRows];
    if (trainerOnly) rows = rows.filter(r => r.employee.trainer_status);
    if (medsOnly) rows = rows.filter(r => r.employee.administers_medications);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        `${r.employee.first_name} ${r.employee.last_name}`.toLowerCase().includes(q) ||
        (r.employee.job_title?.toLowerCase() ?? "").includes(q)
      );
    }
    if (statusFilter !== "all") {
      rows = rows.filter(r => getWorstStatus(r) === statusFilter);
    }
    if (dueWindow !== "all") {
      const days = Number(dueWindow);
      rows = rows.filter(r => isDueWithinWindow(r, days));
    }
    rows = rows.sort((a, b) => {
      let va = "", vb = "";
      if (sortField === "firstName") { va = a.employee.first_name; vb = b.employee.first_name; }
      else if (sortField === "jobTitle") { va = a.employee.job_title ?? ""; vb = b.employee.job_title ?? ""; }
      else { va = a.employee.last_name; vb = b.employee.last_name; }
      return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    });
    return rows;
  }, [matrixRows, trainerOnly, medsOnly, search, statusFilter, dueWindow, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const pageRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const complianceSummary = useMemo(() => {
    const summary: Record<string, { compliant: number; total: number }> = {};
    for (const tt of matrixTrainingTypes) {
      let compliant = 0;
      let total = 0;
      for (const row of filteredRows) {
        const cell = row.cells.find(c => c.trainingTypeId === tt.id);
        // Exclude not_applicable/pending_review cells from the denominator, matching
        // Dashboard.tsx's computeDashboardSummary convention.
        if (cell && RELEVANT_STATUSES.has(cell.status)) {
          total++;
          if (cell.status === "compliant") compliant++;
        }
      }
      summary[tt.id] = { compliant, total };
    }
    return summary;
  }, [matrixTrainingTypes, filteredRows]);

  const handleExportCSV = () => {
    if (matrixTrainingTypes.length === 0) return;
    const headers = ["Employee Name", "Job Title", ...matrixTrainingTypes.map(tt => tt.code)];
    const rows = filteredRows.map(row => {
      const name = `${row.employee.first_name} ${row.employee.last_name}`;
      const jobTitle = row.employee.job_title ?? "";
      const statuses = matrixTrainingTypes.map(tt => {
        const cell = row.cells.find(c => c.trainingTypeId === tt.id);
        return cell ? getStatusLabel(cell.status) : "No Record";
      });
      return [name, jobTitle, ...statuses];
    });

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "training-matrix.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Training Matrix</h1>
        <p className="text-muted-foreground">View compliance status across all employees and training types.</p>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <Select value={facilityId} onValueChange={v => { setFacilityId(v); setPage(1); }}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All Facilities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Facilities</SelectItem>
            {facilities?.map(f => (
              <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="compliant">Compliant</SelectItem>
            <SelectItem value="due_soon">Due Soon</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="missing">Missing</SelectItem>
          </SelectContent>
        </Select>

        <Select value={dueWindow} onValueChange={v => { setDueWindow(v); setPage(1); }}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Due Within" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Due Dates</SelectItem>
            <SelectItem value="30">Due Within 30 Days</SelectItem>
            <SelectItem value="60">Due Within 60 Days</SelectItem>
            <SelectItem value="90">Due Within 90 Days</SelectItem>
          </SelectContent>
        </Select>

        <Input
          placeholder="Search by name or job title..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          className="w-64"
        />

        <div className="flex items-center gap-4 border rounded-md px-3 py-2 bg-background">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={trainerOnly}
              onCheckedChange={(checked) => { setTrainerOnly(!!checked); setPage(1); }}
            />
            Trainer Only
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={medsOnly}
              onCheckedChange={(checked) => { setMedsOnly(!!checked); setPage(1); }}
            />
            Administers Meds
          </label>
        </div>

        <Button variant="outline" size="sm" onClick={handleExportCSV} className="ml-auto">
          <Download className="w-4 h-4 mr-2" />
          Export CSV
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base">
              Compliance Matrix
              <span className="text-sm font-normal text-muted-foreground ml-2">
                ({filteredRows.length} employees)
              </span>
            </CardTitle>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", backgroundColor: "#22c55e" }} />
                Compliant
              </span>
              <span className="flex items-center gap-1.5">
                <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", backgroundColor: "#f59e0b" }} />
                Due Soon
              </span>
              <span className="flex items-center gap-1.5">
                <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", backgroundColor: "#ef4444" }} />
                Expired
              </span>
              <span className="flex items-center gap-1.5">
                <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", backgroundColor: "#94a3b8" }} />
                No Record
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {pageRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Users className="w-16 h-16 text-muted-foreground/40 mb-4" />
              <h3 className="text-lg font-semibold mb-1">No matching employees</h3>
              <p className="text-sm text-muted-foreground mb-4">Try adjusting your filters or search terms</p>
              <Button variant="outline" size="sm" onClick={clearFilters}>Clear Filters</Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b" style={{ position: "sticky", top: 0, zIndex: 10 }}>
                    <th className="text-left py-2 pr-4 font-medium text-muted-foreground sticky left-0 bg-background min-w-[180px]">
                      <span>Employee</span>
                      <SortButton field="lastName" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="text-left py-2 pr-4 font-medium text-muted-foreground min-w-[140px] bg-background">
                      <span>Role</span>
                      <SortButton field="jobTitle" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                    </th>
                    {matrixTrainingTypes.map(tt => (
                      <th key={tt.id} className="text-center py-2 px-2 font-medium text-muted-foreground min-w-[90px] max-w-[110px] bg-background">
                        <div className="truncate text-xs" title={tt.name}>{tt.code}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map(row => (
                    <tr key={row.employee.id} className="border-b hover:bg-muted/30">
                      <td className="py-2 pr-4 sticky left-0 bg-background">
                        <div className="font-medium">{row.employee.first_name} {row.employee.last_name}</div>
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground text-xs">{row.employee.job_title}</td>
                      {matrixTrainingTypes.map(tt => {
                        const cell = row.cells.find(c => c.trainingTypeId === tt.id);
                        return (
                          <td key={tt.id} className="py-2 px-2 text-center">
                            <StatusDot
                              entry={cell}
                              onClick={() => setSelectedCell({
                                entry: cell ?? { trainingTypeId: tt.id, trainingRecordId: null, status: "missing", completionDate: null, dueDate: null, trainerName: null, hours: null },
                                trainingTypeName: tt.name,
                                employeeName: `${row.employee.first_name} ${row.employee.last_name}`,
                                employeeId: row.employee.id,
                              })}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr className="border-t-2 bg-muted/20">
                    <td className="py-2 pr-4 sticky left-0 bg-muted/20 font-medium text-xs text-muted-foreground">Summary</td>
                    <td className="py-2 pr-4"></td>
                    {matrixTrainingTypes.map(tt => {
                      const s = complianceSummary[tt.id];
                      return (
                        <td key={tt.id} className="py-2 px-2 text-center text-xs font-medium text-muted-foreground" title={`${s?.compliant ?? 0} compliant out of ${s?.total ?? 0} with records`}>
                          {s ? `${s.compliant}/${s.total}` : "-"}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t">
              <span className="text-sm text-muted-foreground">
                Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, filteredRows.length)} of {filteredRows.length}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                <span className="text-sm flex items-center px-2">Page {page} of {totalPages}</span>
                <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <CellDetailDialog
        open={!!selectedCell}
        onClose={() => setSelectedCell(null)}
        entry={selectedCell?.entry ?? null}
        trainingTypeName={selectedCell?.trainingTypeName ?? ""}
        employeeName={selectedCell?.employeeName ?? ""}
        employeeId={selectedCell?.employeeId ?? ""}
      />
    </div>
  );
}
