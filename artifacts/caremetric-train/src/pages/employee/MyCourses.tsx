import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useGetEmployeeByProfileId } from "@/hooks/useEmployees";
import { useListCourseAssignments, useSelfEnrollCourse } from "@/hooks/useCourseAssignments";
import { useListCourses } from "@/hooks/useCourses";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GraduationCap, ChevronRight, BookOpen, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// assigned -> "Start" (nothing begun yet); in_progress/overdue -> "Continue" (progress already
// exists, or the due date passed either way); completed -> "Review" (re-open a finished course).
function actionLabel(status: string) {
  if (status === "completed") return "Review";
  if (status === "assigned") return "Start";
  return "Continue";
}

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
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [statusFilter, setStatusFilter] = useState("all");
  const [enrollingCourseId, setEnrollingCourseId] = useState<string | null>(null);

  const { data: employee, isLoading: employeeLoading } = useGetEmployeeByProfileId(user?.id);
  const { data: assignments, isLoading: assignmentsLoading } = useListCourseAssignments({ employeeId: employee?.id });
  const { data: courses } = useListCourses();
  const { mutate: selfEnroll, isPending: enrolling } = useSelfEnrollCourse();

  const isLoading = employeeLoading || assignmentsLoading;
  const courseById = new Map((courses ?? []).map(c => [c.id, c]));

  const allAssignments = assignments ?? [];
  const filtered = statusFilter === "all" ? allAssignments : allAssignments.filter(a => a.status === statusFilter);

  // Published courses this account hasn't already been assigned -- the self-service entry point
  // for any role (not just employee) to start a course on their own, without waiting for an
  // admin/trainer to assign it via the "Assign Course" dialog.
  const assignedCourseIds = new Set(allAssignments.map(a => a.course_id));
  const availableCourses = (courses ?? []).filter(c => c.status === "published" && !assignedCourseIds.has(c.id));

  const handleStart = (courseId: string) => {
    setEnrollingCourseId(courseId);
    selfEnroll(courseId, {
      onSuccess: (assignmentId) => navigate(`/me/courses/${assignmentId}`),
      onError: (e: Error) => {
        toast({ title: "Couldn't start course", description: e.message, variant: "destructive" });
        setEnrollingCourseId(null);
      },
    });
  };

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
        <p className="text-muted-foreground">Every course assigned to you, plus anything else you can start on your own.</p>
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
                  <div key={a.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{course?.title ?? "Course"}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.due_date ? `Due ${new Date(a.due_date).toLocaleDateString()}` : "No due date"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={a.status} />
                      <Button asChild size="sm">
                        <Link href={`/me/courses/${a.id}`}>
                          {actionLabel(a.status)}
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Available Courses ({availableCourses.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {availableCourses.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">
              No other published courses to start right now.
            </p>
          ) : (
            availableCourses.map(course => (
              <div key={course.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border">
                <div className="min-w-0">
                  <p className="font-medium truncate">{course.title}</p>
                  <p className="text-xs text-muted-foreground">{course.category ?? "Uncategorized"}</p>
                </div>
                <Button
                  size="sm"
                  disabled={enrolling && enrollingCourseId === course.id}
                  onClick={() => handleStart(course.id)}
                >
                  {enrolling && enrollingCourseId === course.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>Start <ChevronRight className="h-4 w-4" /></>
                  )}
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
