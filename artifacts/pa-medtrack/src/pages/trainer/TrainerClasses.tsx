import { useState } from "react";
import { useListTrainingRecords, useListEmployees, useListFacilities } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { GraduationCap, Search, ChevronLeft, ChevronRight } from "lucide-react";

type TrainingRecord = {
  id: number;
  employeeId: number;
  status: string;
  completionDate?: string | null;
  dueDate?: string | null;
  trainingTypeName?: string | null;
  facilityId?: number;
  trainerName?: string | null;
};

const PAGE_SIZE = 10;

export default function TrainerClasses() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [facilityFilter, setFacilityFilter] = useState("all");
  const [sortField, setSortField] = useState<"dueDate" | "status" | "employeeId">("dueDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);

  const { data: records, isLoading } = useListTrainingRecords({
    status: statusFilter !== "all" ? statusFilter : undefined,
  });
  const { data: employees } = useListEmployees({});
  const { data: facilities } = useListFacilities({});

  const allRecords = (records as TrainingRecord[] | undefined) ?? [];
  const employeeMap = new Map((employees ?? []).map(e => [e.id, e]));

  const filtered = allRecords.filter(r => {
    if (facilityFilter !== "all" && String(r.facilityId) !== facilityFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      const emp = employeeMap.get(r.employeeId);
      const name = emp ? `${emp.firstName} ${emp.lastName}`.toLowerCase() : "";
      const type = (r.trainingTypeName ?? "").toLowerCase();
      if (!name.includes(s) && !type.includes(s)) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortField === "dueDate") {
      const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const db_ = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      cmp = da - db_;
    } else if (sortField === "status") {
      cmp = (a.status ?? "").localeCompare(b.status ?? "");
    } else if (sortField === "employeeId") {
      const ea = employeeMap.get(a.employeeId);
      const eb = employeeMap.get(b.employeeId);
      cmp = (`${ea?.lastName ?? ""} ${ea?.firstName ?? ""}`).localeCompare(`${eb?.lastName ?? ""} ${eb?.firstName ?? ""}`);
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paginated = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function toggleSort(field: typeof sortField) {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
    setPage(1);
  }

  const sortIndicator = (field: typeof sortField) =>
    sortField === field ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Training Records</h1>
        <p className="text-muted-foreground">Manage and track all training records for your facilities.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5" />
            Training Records ({filtered.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 mb-4">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by employee or training type..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="compliant">Compliant</SelectItem>
                <SelectItem value="due_soon">Due Soon</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
                <SelectItem value="missing">Missing</SelectItem>
              </SelectContent>
            </Select>
            <Select value={facilityFilter} onValueChange={v => { setFacilityFilter(v); setPage(1); }}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Facility" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Facilities</SelectItem>
                {(facilities ?? []).map(f => (
                  <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded" />)}
            </div>
          ) : paginated.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">No training records found.</p>
          ) : (
            <>
              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-3 cursor-pointer hover:bg-muted" onClick={() => toggleSort("employeeId")}>
                        Employee{sortIndicator("employeeId")}
                      </th>
                      <th className="text-left p-3">Training Type</th>
                      <th className="text-left p-3 cursor-pointer hover:bg-muted" onClick={() => toggleSort("status")}>
                        Status{sortIndicator("status")}
                      </th>
                      <th className="text-left p-3 cursor-pointer hover:bg-muted" onClick={() => toggleSort("dueDate")}>
                        Due Date{sortIndicator("dueDate")}
                      </th>
                      <th className="text-left p-3">Completion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map(r => {
                      const emp = employeeMap.get(r.employeeId);
                      return (
                        <tr key={r.id} className="border-t hover:bg-muted/30">
                          <td className="p-3">
                            {emp ? `${emp.lastName}, ${emp.firstName}` : `#${r.employeeId}`}
                          </td>
                          <td className="p-3 text-muted-foreground">{r.trainingTypeName ?? "—"}</td>
                          <td className="p-3">
                            <Badge variant={
                              r.status === "compliant" ? "default" :
                              r.status === "expired" ? "destructive" :
                              "secondary"
                            }>
                              {r.status}
                            </Badge>
                          </td>
                          <td className="p-3 text-muted-foreground">
                            {r.dueDate ? new Date(r.dueDate).toLocaleDateString() : "—"}
                          </td>
                          <td className="p-3 text-muted-foreground">
                            {r.completionDate ? new Date(r.completionDate).toLocaleDateString() : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">
                  Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)} of {sorted.length}
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm">Page {page} of {totalPages}</span>
                  <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
