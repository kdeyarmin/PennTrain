import { useState, useMemo } from "react";
import { useListTrainingRecords, useListEmployees, useListTrainingTypes, useListFacilities } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChevronUp, ChevronDown, ChevronsUpDown, Download, Users } from "lucide-react";

const PAGE_SIZE = 15;

type SortDir = "asc" | "desc";

type Employee = {
  id: number;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  facilityId: number | null;
};

type TrainingRecord = {
  id: number;
  employeeId: number;
  trainingTypeId: number;
  status: string;
  completionDate?: string | null;
  dueDate?: string | null;
};

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

function buildTooltip(record: TrainingRecord | undefined): string {
  if (!record) return "No Record";
  const parts = [getStatusLabel(record.status)];
  if (record.completionDate) parts.push(`Completed: ${record.completionDate}`);
  if (record.dueDate) parts.push(`Due: ${record.dueDate}`);
  return parts.join("\n");
}

function StatusDot({ record }: { record: TrainingRecord | undefined }) {
  const color = getStatusColor(record?.status);
  const tooltip = buildTooltip(record);
  return (
    <span
      title={tooltip}
      style={{
        display: "inline-block",
        width: 12,
        height: 12,
        borderRadius: "50%",
        backgroundColor: color,
        cursor: "default",
      }}
    />
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

export default function TrainingMatrix() {
  const [facilityId, setFacilityId] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<string>("lastName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);

  const { data: facilities } = useListFacilities({});
  const { data: allEmployees } = useListEmployees({
    facilityId: facilityId && facilityId !== "all" ? Number(facilityId) : undefined,
    status: "active",
  });
  const { data: trainingTypes } = useListTrainingTypes({ isActive: true });
  const { data: records } = useListTrainingRecords({
    facilityId: facilityId && facilityId !== "all" ? Number(facilityId) : undefined,
  });

  const getRecord = (employeeId: number, trainingTypeId: number): TrainingRecord | undefined => {
    return (records as TrainingRecord[] | undefined)?.find(
      r => r.employeeId === employeeId && r.trainingTypeId === trainingTypeId
    );
  };

  const getWorstStatus = (emp: Employee): string => {
    const empRecords = (records as TrainingRecord[] | undefined)?.filter(r => r.employeeId === emp.id) ?? [];
    if (empRecords.some(r => r.status === "expired")) return "expired";
    if (empRecords.some(r => r.status === "missing")) return "missing";
    if (empRecords.some(r => r.status === "due_soon")) return "due_soon";
    if (empRecords.every(r => r.status === "compliant") && empRecords.length > 0) return "compliant";
    return "missing";
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
    setPage(1);
  };

  const filteredEmployees = useMemo(() => {
    let emps = (allEmployees as Employee[] | undefined) ?? [];
    if (search.trim()) {
      const q = search.toLowerCase();
      emps = emps.filter(e =>
        `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
        (e.jobTitle?.toLowerCase() ?? "").includes(q)
      );
    }
    if (statusFilter !== "all") {
      emps = emps.filter(e => getWorstStatus(e) === statusFilter);
    }
    emps = [...emps].sort((a, b) => {
      let va = "", vb = "";
      if (sortField === "firstName") { va = a.firstName; vb = b.firstName; }
      else if (sortField === "jobTitle") { va = a.jobTitle ?? ""; vb = b.jobTitle ?? ""; }
      else { va = a.lastName; vb = b.lastName; }
      return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    });
    return emps;
  }, [allEmployees, search, statusFilter, sortField, sortDir, records]);

  const totalPages = Math.max(1, Math.ceil(filteredEmployees.length / PAGE_SIZE));
  const pageEmployees = filteredEmployees.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const complianceSummary = useMemo(() => {
    if (!trainingTypes) return {};
    const summary: Record<number, { compliant: number; total: number }> = {};
    for (const tt of trainingTypes) {
      let compliant = 0;
      let total = 0;
      for (const emp of filteredEmployees) {
        const rec = getRecord(emp.id, tt.id);
        if (rec) {
          total++;
          if (rec.status === "compliant") compliant++;
        }
      }
      summary[tt.id] = { compliant, total };
    }
    return summary;
  }, [trainingTypes, filteredEmployees, records]);

  const handleExportCSV = () => {
    if (!trainingTypes) return;
    const headers = ["Employee Name", "Job Title", ...trainingTypes.map(tt => tt.code)];
    const rows = filteredEmployees.map(emp => {
      const name = `${emp.firstName} ${emp.lastName}`;
      const jobTitle = emp.jobTitle ?? "";
      const statuses = trainingTypes.map(tt => {
        const rec = getRecord(emp.id, tt.id);
        return rec ? getStatusLabel(rec.status) : "No Record";
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

        <Input
          placeholder="Search by name or job title..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          className="w-64"
        />

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
                ({filteredEmployees.length} employees)
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
          {pageEmployees.length === 0 ? (
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
                    {trainingTypes?.map(tt => (
                      <th key={tt.id} className="text-center py-2 px-2 font-medium text-muted-foreground min-w-[90px] max-w-[110px] bg-background">
                        <div className="truncate text-xs" title={tt.name}>{tt.code}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageEmployees.map(emp => (
                    <tr key={emp.id} className="border-b hover:bg-muted/30">
                      <td className="py-2 pr-4 sticky left-0 bg-background">
                        <div className="font-medium">{emp.firstName} {emp.lastName}</div>
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground text-xs">{emp.jobTitle}</td>
                      {trainingTypes?.map(tt => {
                        const record = getRecord(emp.id, tt.id);
                        return (
                          <td key={tt.id} className="py-2 px-2 text-center">
                            <StatusDot record={record} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr className="border-t-2 bg-muted/20">
                    <td className="py-2 pr-4 sticky left-0 bg-muted/20 font-medium text-xs text-muted-foreground">Summary</td>
                    <td className="py-2 pr-4"></td>
                    {trainingTypes?.map(tt => {
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
                Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, filteredEmployees.length)} of {filteredEmployees.length}
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
    </div>
  );
}
