import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useGetEmployeeByProfileId } from "@/hooks/useEmployees";
import { useListTrainingRecords, type TrainingRecord } from "@/hooks/useTrainingRecords";
import { useListTrainingTypes } from "@/hooks/useTrainingTypes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { GraduationCap, Search, ChevronLeft, ChevronRight } from "lucide-react";

const PAGE_SIZE = 10;

export default function MyTrainings() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortField, setSortField] = useState<"dueDate" | "status" | "trainingTypeName">("dueDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);

  const { data: employee, isLoading: employeeLoading } = useGetEmployeeByProfileId(user?.id);
  const { data: records, isLoading: recordsLoading } = useListTrainingRecords({ employeeId: employee?.id });
  const { data: trainingTypes } = useListTrainingTypes();

  const isLoading = employeeLoading || recordsLoading;
  const allRecords = records ?? [];

  const typeNameById = new Map((trainingTypes ?? []).map(t => [t.id, t.name]));
  const trainingTypeName = (r: TrainingRecord) => typeNameById.get(r.training_type_id) ?? `Training #${r.id.slice(0, 8)}`;

  const filtered = allRecords.filter(r => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      if (!trainingTypeName(r).toLowerCase().includes(s)) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortField === "dueDate") {
      const da = a.due_date ? new Date(a.due_date).getTime() : Infinity;
      const db_ = b.due_date ? new Date(b.due_date).getTime() : Infinity;
      cmp = da - db_;
    } else if (sortField === "status") {
      cmp = (a.status ?? "").localeCompare(b.status ?? "");
    } else if (sortField === "trainingTypeName") {
      cmp = trainingTypeName(a).localeCompare(trainingTypeName(b));
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
        <h1 className="text-2xl font-bold tracking-tight">My Training Records</h1>
        <p className="text-muted-foreground">View all your training records and compliance history.</p>
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
                placeholder="Search by training type..."
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
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded" />)}
            </div>
          ) : paginated.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">No training records found.</p>
          ) : (
            <>
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-sm min-w-[520px]">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-3 cursor-pointer hover:bg-muted" onClick={() => toggleSort("trainingTypeName")}>
                        Training Type{sortIndicator("trainingTypeName")}
                      </th>
                      <th className="text-left p-3 cursor-pointer hover:bg-muted" onClick={() => toggleSort("status")}>
                        Status{sortIndicator("status")}
                      </th>
                      <th className="text-left p-3 cursor-pointer hover:bg-muted" onClick={() => toggleSort("dueDate")}>
                        Due Date{sortIndicator("dueDate")}
                      </th>
                      <th className="text-left p-3">Completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map(r => (
                      <tr key={r.id} className="border-t hover:bg-muted/30">
                        <td className="p-3 font-medium">{trainingTypeName(r)}</td>
                        <td className="p-3">
                          <Badge variant={
                            r.status === "compliant" ? "default" :
                            r.status === "expired" ? "destructive" :
                            "secondary"
                          }>
                            {r.status === "due_soon" ? "Due Soon" : r.status}
                          </Badge>
                        </td>
                        <td className="p-3 text-muted-foreground">
                          {r.due_date ? new Date(r.due_date).toLocaleDateString() : "—"}
                        </td>
                        <td className="p-3 text-muted-foreground">
                          {r.completion_date ? new Date(r.completion_date).toLocaleDateString() : "—"}
                        </td>
                      </tr>
                    ))}
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
