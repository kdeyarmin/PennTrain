import { useMemo, useState } from "react";
import { daysUntil, formatDateForDisplay, formatDueDistance } from "@/lib/dateUtils";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useGetEmployeeByProfileId } from "@/hooks/useEmployees";
import { useListCourseAssignments, useSelfEnrollCourse } from "@/hooks/useCourseAssignments";
import {
  useListCourses,
  useListCourseVersionsByIds,
  canEnrollInCourse,
  isCourseVersionLearnerReady,
} from "@/hooks/useCourses";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { QueryError } from "@/components/QueryState";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GraduationCap, ChevronRight, BookOpen, Loader2, CloudDownload, HardDrive, Trash2, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { canSelfEnrollInCourse } from "@/lib/courseAvailability";
import { useDownloadCourseForOffline, useOfflineCourseLibrary, useRemoveOfflineCourse, useWipeOfflineCourses } from "@/hooks/useOfflineLearning";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

// assigned -> "Start" (nothing begun yet); in_progress/overdue -> "Continue" (progress already
// exists, or the due date passed either way); completed -> "Review" (re-open a finished course).
function actionLabel(status: string) {
  if (status === "completed") return "Review";
  if (status === "assigned") return "Start";
  return "Continue";
}

// Every training assignment, regardless of due date -- before this page existed, the only place a
// employee training assignments surfaced at all was the dashboard's "Upcoming Deadlines" widget, which
// explicitly drops any assignment with a null due_date, making it unreachable in the app
// (ROADMAP.md Tier 3.4: "assignments without due dates are unreachable today").
export default function MyCourses() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: employee, isLoading: employeeLoading } = useGetEmployeeByProfileId(user?.id);
  // Gate on a resolved employee id, not just pass it through as a filter -- for a role that's
  // never self-enrolled before (org_admin/auditor/platform_admin pre-ensure_employee_record),
  // there is no employees row yet, and an undefined employeeId would otherwise fetch every
  // assignment RLS allows (org-wide, or platform-wide for platform_admin) instead of none. See
  // useListCourseAssignments' own comment on why `enabled` -- not just the filter -- is required.
  const {
    data: assignments,
    isLoading: assignmentsLoading,
    isError: assignmentsError,
    error: assignmentsErrorDetail,
    refetch: refetchAssignments,
  } = useListCourseAssignments(
    { employeeId: employee?.id },
    { enabled: !!employee?.id },
  );
  const {
    data: courses,
    isLoading: coursesLoading,
    isError: coursesError,
    error: coursesErrorDetail,
    refetch: refetchCourses,
  } = useListCourses();
  const currentVersionIds = useMemo(
    () => (courses ?? []).map(c => c.current_version_id).filter((id): id is string => !!id),
    [courses],
  );
  const { data: currentVersions, isLoading: currentVersionsLoading } = useListCourseVersionsByIds(currentVersionIds);
  const { mutate: selfEnroll, isPending: enrolling, variables: enrollingCourseId } = useSelfEnrollCourse();
  const offlineLibrary = useOfflineCourseLibrary();
  const downloadOffline = useDownloadCourseForOffline();
  const removeOffline = useRemoveOfflineCourse();
  const wipeOffline = useWipeOfflineCourses();

  const isLoading = employeeLoading || assignmentsLoading;
  const coursesReadyLoading = coursesLoading || currentVersionsLoading;
  const courseById = useMemo(() => new Map((courses ?? []).map(c => [c.id, c])), [courses]);
  const currentVersionById = useMemo(() => new Map((currentVersions ?? []).map(v => [v.id, v])), [currentVersions]);

  // Prefer the employees row org when it exists; fall back to the profile org so that
  // org_admin/auditor who haven't self-enrolled yet (no employees row) still see their org's
  // published training items in the "Available Training" list rather than an empty page.
  const effectiveOrgId = employee?.organization_id ?? user?.organizationId ?? undefined;

  const allAssignments = assignments ?? [];
  const filtered = statusFilter === "all" ? allAssignments : allAssignments.filter(a => a.status === statusFilter);

  // Published courses this account hasn't already been assigned and could actually self-enroll
  // in -- the self-service entry point for any role (not just employee) to start a course on
  // their own, without waiting for an admin/trainer to assign it via the "Assign Training" dialog.
  // canEnrollInCourse matters for platform_admin specifically: RLS lets that role see every
  // organization's courses, but self_enroll_course only ever accepts system-catalog courses or
  // the caller's own (for platform_admin, always the internal) org's.
  const availableCourses = (courses ?? []).filter(
    c =>
      c.status === "published"
      && canSelfEnrollInCourse(c, allAssignments)
      && canEnrollInCourse(c, effectiveOrgId)
      && isCourseVersionLearnerReady(c.current_version_id ? currentVersionById.get(c.current_version_id) : null),
  );

  const handleStart = (courseId: string) => {
    selfEnroll(courseId, {
      onSuccess: (assignmentId) => navigate(`/me/courses/${assignmentId}`),
      onError: (e: Error) => {
        toast({ title: "Couldn't start training", description: e.message, variant: "destructive" });
      },
    });
  };

  // Overdue first (most urgent), then in_progress, then not-yet-started, then completed last --
  // surfaces active work ahead of what's already done, with due date as the tiebreak within each
  // bucket.
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
        <h1 className="text-2xl font-bold tracking-tight">My Training</h1>
        <p className="text-muted-foreground">Every training item assigned to you, plus anything else you can start on your own.</p>
      </div>

      {user?.role === "employee" && <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><HardDrive className="h-5 w-5" />Offline training library ({offlineLibrary.data?.length ?? 0})</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Alert><ShieldCheck className="h-4 w-4" /><AlertTitle>Encrypted on this device</AlertTitle><AlertDescription>Only assigned course content and quiz prompts are cached. Answer keys, resident data, personnel lists, credentials, reports, and access tokens are excluded. Downloads expire after 30 days and are wiped when this device registration is revoked.</AlertDescription></Alert>
          {offlineLibrary.data?.length ? offlineLibrary.data.map((item) => <div key={item.assignmentId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><p className="font-medium">{item.title}</p><p className="text-xs text-muted-foreground">Downloaded {new Date(item.downloadedAt).toLocaleString()} · expires {new Date(item.expiresAt).toLocaleDateString()}</p></div><div className="flex gap-2"><Button asChild size="sm" variant="outline"><Link href={`/me/courses/${item.assignmentId}/offline`}>Open offline copy</Link></Button><Button size="icon" variant="ghost" aria-label={`Remove offline copy of ${item.title}`} disabled={removeOffline.isPending} onClick={() => removeOffline.mutate(item.assignmentId)}><Trash2 className="h-4 w-4" /></Button></div></div>) : <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No courses are available offline yet. Use Download on an active assignment below.</p>}
          {(offlineLibrary.data?.length ?? 0) > 0 && <Button variant="outline" disabled={wipeOffline.isPending} onClick={() => wipeOffline.mutate(undefined, { onSuccess: () => toast({ title: "Offline training wiped from this device" }), onError: (error) => toast({ title: "Offline library could not be wiped", description: error.message, variant: "destructive" }) })}><Trash2 className="mr-2 h-4 w-4" />Revoke device and wipe all</Button>}
        </CardContent>
      </Card>}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5" />
            Assigned Training {!isLoading && `(${filtered.length})`}
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

          {assignmentsError ? (
            <QueryError what="your assigned training" error={assignmentsErrorDetail} onRetry={() => refetchAssignments()} />
          ) : isLoading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />)}
            </div>
          ) : sorted.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">No training assigned yet.</p>
          ) : (
            <div className="space-y-2">
              {sorted.map(a => {
                const course = courseById.get(a.course_id);
                // Urgency only matters while the work is still open -- a completed training item's old
                // due date shouldn't shout "overdue."
                const dueDistance = a.status !== "completed" ? formatDueDistance(a.due_date) : null;
                const daysLeft = daysUntil(a.due_date);
                const dueTone =
                  daysLeft !== null && daysLeft < 0
                    ? "text-destructive font-medium"
                    : daysLeft !== null && daysLeft <= 7
                      ? "text-amber-600 font-medium"
                      : "";
                return (
                  <div key={a.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{course?.title ?? "Training item"}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.due_date ? `Due ${formatDateForDisplay(a.due_date)}` : "No due date"}
                        {dueDistance && <span className={dueTone}> · {dueDistance}</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={a.status} />
                      {user?.role === "employee" && a.status !== "completed" && <Button size="sm" variant="outline" disabled={downloadOffline.isPending || offlineLibrary.data?.some((item) => item.assignmentId === a.id)} onClick={() => downloadOffline.mutate({ assignmentId: a.id, title: course?.title ?? "Training item" }, { onSuccess: () => toast({ title: "Course encrypted for offline use" }), onError: (error) => toast({ title: "Course could not be downloaded", description: error.message, variant: "destructive" }) })}>{downloadOffline.isPending && downloadOffline.variables?.assignmentId === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudDownload className="h-4 w-4" />}<span className="sr-only">Download for offline use</span></Button>}
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
            Available Training {!coursesReadyLoading && `(${availableCourses.length})`}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {coursesError ? (
            <QueryError what="available training" error={coursesErrorDetail} onRetry={() => refetchCourses()} />
          ) : coursesReadyLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />)}
            </div>
          ) : availableCourses.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">
              No other published training items to start right now.
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
                  ) : allAssignments.some(a => a.course_id === course.id && a.status === "completed") ? (
                    <>Retake <ChevronRight className="h-4 w-4" /></>
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
