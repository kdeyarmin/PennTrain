import { useState, useMemo } from "react";
import { useGetTrainingMatrix, useListFacilities } from "@workspace/api-client-react";
import type { TrainingMatrix, TrainingMatrixRow, TrainingMatrixCell } from "@workspace/api-client-react";
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

const STATUS_COLORS: Record<string, string> = {
  compliant: "#22c55e",
  due_soon: "#f59e0b",
  expired: "#ef4444",
  missing: "#94a3b8",
};

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

function StatusDot({ entry, onClick }: { entry: TrainingMatrixCell | undefined; onClick?: () => void }) {
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
  entry: TrainingMatrixCell | null;
  trainingTypeName: string;
  employeeName: string;
  employeeId: number;
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
          </div>

          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => { onClose(); navigate(`/employees/${employeeId}`); }}
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
  const [selectedCell, setSelectedCell] = useState<{ entry: TrainingMatrixCell; trainingTypeName: string; employeeName: string; employeeId: number } | null>(null);

  const { data: facilities } = useListFacilities({});
  const { data: matrixData } = useGetTrainingMatrix({
    facilityId: facilityId && facilityId !== "all" ? Number(facilityId) : undefined,
    trainerOnly: trainerOnly ? true : undefined,
    administersMedications: medsOnly ? true : undefined,
  });

  const matrix = matrixData as TrainingMatrix | undefined;
  const matrixRows = matrix?.rows ?? [];
  const matrixTrainingTypes = matrix?.trainingTypes ?? [];

  const getWorstStatus = (row: TrainingMatrixRow): string => {
    if (row.cells.some(c => c.status === "expired")) return "expired";
    if (row.cells.some(c => c.status === "missing")) return "missing";
    if (row.cells.some(c => c.status === "due_soon")) return "due_soon";
    if (row.cells.every(c => c.status === "compliant") && row.cells.length > 0) return "compliant";
    return "missing";
  };

  const isDueWithinWindow = (row: TrainingMatrixRow, days: number): boolean => {
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
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        `${r.employee.firstName} ${r.employee.lastName}`.toLowerCase().includes(q) ||
        (r.employee.jobTitle?.toLowerCase() ?? "").includes(q)
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
      if (sortField === "firstName") { va = a.employee.firstName; vb = b.employee.firstName; }
      else if (sortField === "jobTitle") { va = a.employee.jobTitle ?? ""; vb = b.employee.jobTitle ?? ""; }
      else { va = a.employee.lastName; vb = b.employee.lastName; }
      return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    });
    return rows;
  }, [matrixRows, search, statusFilter, dueWindow, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const pageRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const complianceSummary = useMemo(() => {
    const summary: Record<number, { compliant: number; total: number }> = {};
    for (const tt of matrixTrainingTypes) {
      let compliant = 0;
      let total = 0;
      for (const row of filteredRows) {
        const cell = row.cells.find(c => c.trainingTypeId === tt.id);
        if (cell) {
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
      const name = `${row.employee.firstName} ${row.employee.lastName}`;
      const jobTitle = row.employee.jobTitle ?? "";
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
              <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
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
                        <div className="font-medium">{row.employee.firstName} {row.employee.lastName}</div>
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground text-xs">{row.employee.jobTitle}</td>
                      {matrixTrainingTypes.map(tt => {
                        const cell = row.cells.find(c => c.trainingTypeId === tt.id);
                        return (
                          <td key={tt.id} className="py-2 px-2 text-center">
                            <StatusDot
                              entry={cell}
                              onClick={() => setSelectedCell({
                                entry: cell ?? { trainingTypeId: tt.id, trainingRecordId: null, status: "missing", completionDate: null, dueDate: null, hasDocument: false },
                                trainingTypeName: tt.name,
                                employeeName: `${row.employee.firstName} ${row.employee.lastName}`,
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
        employeeId={selectedCell?.employeeId ?? 0}
      />
    </div>
  );
}
