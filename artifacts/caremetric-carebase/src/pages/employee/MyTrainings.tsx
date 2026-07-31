import { useState } from "react";
import { daysUntil, formatDateForDisplay, formatDueDistance } from "@/lib/dateUtils";
import { useAuth } from "@/lib/auth";
import { useGetEmployeeByProfileId } from "@/hooks/useEmployees";
import { useListTrainingRecords, type TrainingRecord } from "@/hooks/useTrainingRecords";
import { useListTrainingTypes } from "@/hooks/useTrainingTypes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { QueryError } from "@/components/QueryState";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BookOpen, GraduationCap } from "lucide-react";
import { Link } from "wouter";

export default function MyTrainings() {
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: employee, isLoading: employeeLoading } = useGetEmployeeByProfileId(user?.id);
  // Gate on a resolved employee id -- see useListTrainingRecords' own comment on why `enabled`,
  // not just the filter, is required to avoid an unscoped fetch-then-refetch on every page load.
  const {
    data: records,
    isLoading: recordsLoading,
    isError: recordsError,
    error: recordsErrorDetail,
    refetch: refetchRecords,
  } = useListTrainingRecords(
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Training Records</h1>
          <p className="text-muted-foreground">View your compliance history. To start or continue assigned learning, open My Training.</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/me/courses"><BookOpen className="mr-2 h-4 w-4" />Go to My Training</Link>
        </Button>
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

          {recordsError ? (
            <QueryError what="your training records" error={recordsErrorDetail} onRetry={() => refetchRecords()} />
          ) : isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-muted animate-pulse rounded" />)}
            </div>
          ) : sorted.length === 0 ? (
            <div className="space-y-3 py-8 text-center">
              <p className="text-muted-foreground text-sm">No training records found.</p>
              <Button asChild size="sm">
                <Link href="/me/courses">Browse assigned training</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {sorted.map(r => {
                const needsAction = r.status === "due_soon" || r.status === "expired" || r.status === "missing";
                const dueDistance = needsAction ? formatDueDistance(r.due_date) : null;
                const daysLeft = daysUntil(r.due_date);
                const dueTone =
                  daysLeft !== null && daysLeft < 0
                    ? "text-destructive font-medium"
                    : daysLeft !== null && daysLeft <= 7
                      ? "text-amber-600 font-medium"
                      : "";
                return (
                  <div key={r.id} className="flex items-center justify-between gap-4 p-3 rounded-lg border">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{trainingTypeName(r)}</p>
                      <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground mt-0.5">
                        {r.completion_date && <span>Completed {formatDateForDisplay(r.completion_date)}</span>}
                        {r.due_date && r.status !== "compliant" && (
                          <span className={dueTone}>
                            Due {formatDateForDisplay(r.due_date)}
                            {dueDistance ? ` · ${dueDistance}` : ""}
                          </span>
                        )}
                        {!r.completion_date && !r.due_date && <span>No dates on file</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={r.status} />
                      {needsAction && (
                        <Button asChild size="sm" variant="outline">
                          <Link href="/me/courses">Find training</Link>
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
