import { useState } from "react";
import { formatDateForDisplay } from "@/lib/dateUtils";
import { useAuth } from "@/lib/auth";
import { useGetEmployeeByProfileId } from "@/hooks/useEmployees";
import { useListTrainingRecords, type TrainingRecord } from "@/hooks/useTrainingRecords";
import { useListTrainingTypes } from "@/hooks/useTrainingTypes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GraduationCap } from "lucide-react";

export default function MyTrainings() {
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: employee, isLoading: employeeLoading } = useGetEmployeeByProfileId(user?.id);
  // Gate on a resolved employee id -- see useListTrainingRecords' own comment on why `enabled`,
  // not just the filter, is required to avoid an unscoped fetch-then-refetch on every page load.
  const { data: records, isLoading: recordsLoading } = useListTrainingRecords(
    { employeeId: employee?.id },
    { enabled: !!employee?.id },
  );
  const { data: trainingTypes } = useListTrainingTypes();

  const isLoading = employeeLoading || recordsLoading;
  const allRecords = records ?? [];

  const typeNameById = new Map((trainingTypes ?? []).map(t => [t.id, t.name]));
  const trainingTypeName = (r: TrainingRecord) => typeNameById.get(r.training_type_id) ?? `Training #${r.id.slice(0, 8)}`;

  const filtered = statusFilter === "all" ? allRecords : allRecords.filter(r => r.status === statusFilter);

  // Soonest due date first (most urgent), records with no due date last -- this list is inherently
  // short per employee (roughly one row per required training type), so a fixed, sensible default
  // sort plus a status filter is enough; no column-sort-by-header or pagination needed.
  const sorted = [...filtered].sort((a, b) => {
    const da = a.due_date ? new Date(a.due_date).getTime() : Infinity;
    const db_ = b.due_date ? new Date(b.due_date).getTime() : Infinity;
    return da - db_;
  });

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
        <CardContent className="space-y-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44">
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

          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-muted animate-pulse rounded" />)}
            </div>
          ) : sorted.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">No training records found.</p>
          ) : (
<<<<<<< HEAD
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
=======
            <div className="space-y-2">
              {sorted.map(r => (
                <div key={r.id} className="flex items-center justify-between gap-4 p-3 rounded-lg border">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{trainingTypeName(r)}</p>
                    <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground mt-0.5">
                      {r.completion_date && <span>Completed {formatDateForDisplay(r.completion_date)}</span>}
                      {r.due_date && r.status !== "compliant" && <span>Due {formatDateForDisplay(r.due_date)}</span>}
                      {!r.completion_date && !r.due_date && <span>No dates on file</span>}
                    </div>
                  </div>
                  <StatusBadge status={r.status} className="shrink-0" />
>>>>>>> origin/main
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
