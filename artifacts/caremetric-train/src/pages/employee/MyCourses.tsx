import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { useGetEmployeeByProfileId } from "@/hooks/useEmployees";
import { useListCourseAssignments } from "@/hooks/useCourseAssignments";
import { useListCourses } from "@/hooks/useCourses";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GraduationCap, ChevronRight } from "lucide-react";

// Every course assignment, regardless of due date -- before this page existed, the only place a
// learner's assignments surfaced at all was the dashboard's "Upcoming Deadlines" widget, which
// explicitly drops any assignment with a null due_date, making it unreachable in the app
// (ROADMAP.md Tier 3.4: "assignments without due dates are unreachable today").
function StatusBadge({ status }: { status: string }) {
  const className =
    status === "completed" ? "bg-success text-success-foreground hover:bg-success/80"
    : status === "overdue" ? "bg-destructive text-destructive-foreground hover:bg-destructive/80"
    : status === "in_progress" ? "bg-info text-info-foreground hover:bg-info/80"
    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"; // assigned
  return <Badge className={className} variant="outline">{status.replace(/_/g, " ")}</Badge>;
}

export default function MyCourses() {
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: employee, isLoading: employeeLoading } = useGetEmployeeByProfileId(user?.id);
  const { data: assignments, isLoading: assignmentsLoading } = useListCourseAssignments({ employeeId: employee?.id });
  const { data: courses } = useListCourses();

  const isLoading = employeeLoading || assignmentsLoading;
  const courseById = new Map((courses ?? []).map(c => [c.id, c]));

  const allAssignments = assignments ?? [];
  const filtered = statusFilter === "all" ? allAssignments : allAssignments.filter(a => a.status === statusFilter);

  // Not-yet-started/in-progress first, then overdue, then completed last -- surfaces active work
  // ahead of what's already done, with due date as the tiebreak within each bucket.
  const statusOrder: Record<string, number> = { overdue: 0, in_progress: 1, assigned: 2, completed: 3 };
  const sorted = [...filtered].sort((a, b) => {
    const byStatus = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
    if (byStatus !== 0) return byStatus;
    const da = a.due_date ? new Date(a.due_date).getTime() : Infinity;
    const db_ = b.due_date ? new Date(b.due_date).getTime() : Infinity;
    return da - db_;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Courses</h1>
        <p className="text-muted-foreground">Every course assigned to you, whether or not it has a due date.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5" />
            Courses ({filtered.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="assigned">Assigned</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>

          {isLoading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />)}
            </div>
          ) : sorted.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">No courses assigned yet.</p>
          ) : (
            <div className="space-y-2">
              {sorted.map(a => {
                const course = courseById.get(a.course_id);
                return (
                  <Link key={a.id} href={`/me/courses/${a.id}`}>
                    <div className="flex items-center justify-between gap-3 p-3 rounded-lg border cursor-pointer hover:bg-accent/50 transition-colors">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{course?.title ?? "Course"}</p>
                        <p className="text-xs text-muted-foreground">
                          {a.due_date ? `Due ${new Date(a.due_date).toLocaleDateString()}` : "No due date"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <StatusBadge status={a.status} />
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
