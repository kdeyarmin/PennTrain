import { Input } from "@/components/ui/input";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useMemo, useState } from "react";
import { facilityDaysUntil, formatDateForDisplay, formatDueDistance } from "@/lib/dateUtils";
import { Link, useLocation, useSearch } from "wouter";
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
import { isClosedCourseAssignmentStatus } from "@/lib/courseLearningTools";
import { useDownloadCourseForOffline, useOfflineCourseLibrary, useRemoveOfflineCourse, useWipeOfflineCourses } from "@/hooks/useOfflineLearning";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

// assigned -> "Start" (nothing begun yet); in_progress/overdue -> "Continue" (progress already
// exists, or the due date passed either way); completed -> "Review" (re-open a finished course).
// canceled -> "View": the player refuses to take further work on a closed assignment and says who
// closed it, so offering "Continue" would be an invitation into a dead end (BACKLOG.md J74, Train).
function actionLabel(status: string) {
  if (status === "completed") return "Review";
  if (status === "canceled") return "View";
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
  const searchParams = useSearch();
  const libraryView = new URLSearchParams(searchParams).get("view") === "library";
  const [learningTab, setLearningTab] = useState("required");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [category, setCategory] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const employeeQuery = useGetEmployeeByProfileId(user?.id);
  const { data: employee, isLoading: employeeLoading } = employeeQuery;
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
  const currentVersionsQuery = useListCourseVersionsByIds(currentVersionIds);
  const { data: currentVersions, isLoading: currentVersionsLoading } = currentVersionsQuery;
  const { mutate: selfEnroll, isPending: enrolling, variables: enrollingCourseId } = useSelfEnrollCourse();
  const offlineLibrary = useOfflineCourseLibrary();
  const downloadOffline = useDownloadCourseForOffline();
  const removeOffline = useRemoveOfflineCourse();
  const wipeOffline = useWipeOfflineCourses();

  const requiredAssignments = useQuery({ queryKey: ["course_assignments", "required", employee?.id], enabled: !!employee?.id,
    queryFn: async () => { const { data, error } = await supabase.rpc("get_training_required_assignments", { p_employee_id: employee!.id });
      if (error) throw error; return new Set(data ?? []); } });
  const isLoading = employeeLoading || assignmentsLoading || requiredAssignments.isLoading;
  const coursesReadyLoading = coursesLoading || currentVersionsLoading;
  const courseById = useMemo(() => new Map((courses ?? []).map(c => [c.id, c])), [courses]);
  const currentVersionById = useMemo(() => new Map((currentVersions ?? []).map(v => [v.id, v])), [currentVersions]);

  // Prefer the employees row org when it exists; fall back to the profile org so that
  // org_admin/auditor who haven't self-enrolled yet (no employees row) still see their org's
  // published training items in the "Available Training" list rather than an empty page.
  const effectiveOrgId = employee?.organization_id ?? user?.organizationId ?? undefined;

  const allAssignments = (assignments ?? []).map(a => ({ ...a, is_required: a.is_required || requiredAssignments.data?.has(a.id) === true }));
  const scopedAssignments = allAssignments.filter(a => learningTab === "history" ? ["completed", "canceled"].includes(a.status)
    : !["completed", "canceled"].includes(a.status) && (learningTab === "required" ? a.is_required !== false : a.is_required === false));
  const filtered = statusFilter === "all" ? scopedAssignments : scopedAssignments.filter(a => a.status === statusFilter);
  const planIds = [...new Set(allAssignments.flatMap(a => a.training_plan_id ? [a.training_plan_id] : []))].sort();
  const planNames = useQuery({ queryKey: ["training_plans", "learner-names", planIds], enabled: planIds.length > 0,
    queryFn: async () => { const { data, error } = await supabase.from("training_plans").select("id,name").in("id", planIds); if (error) throw error; return data; } });
  const required = allAssignments.filter(a => a.is_required !== false && a.status !== "canceled");
  const nextRequired = required.filter(a => !["completed", "paused"].includes(a.status)).sort((a, b) =>
    (a.due_date || "9999").localeCompare(b.due_date || "9999") || Number(b.status === "in_progress") - Number(a.status === "in_progress"))[0];

  // Published courses this account hasn't already been assigned and could actually self-enroll
  // in -- the self-service entry point for any role (not just employee) to start a course on
  // their own, without waiting for an admin/trainer to assign it via the "Assign Training" dialog.
  // canEnrollInCourse matters for platform_admin specifically: RLS lets that role see every
  // organization's courses, but self_enroll_course only ever accepts system-catalog courses or
  // the caller's own (for platform_admin, always the internal) org's.
  const availableCourses = (courses ?? []).filter(
    c =>
      c.status === "published"
      && canEnrollInCourse(c, effectiveOrgId)
      && isCourseVersionLearnerReady(c.current_version_id ? currentVersionById.get(c.current_version_id) : null),
  );

  const visibleCourses = availableCourses.filter(course => (!category || course.category === category)
    && `${course.title} ${course.description || ""}`.toLowerCase().includes(catalogSearch.toLowerCase()));
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
        <h1 className="text-2xl font-bold tracking-tight">{libraryView ? "Course Library" : "My Learning"}</h1>
        <p className="text-muted-foreground">Complete your required learning, explore other courses, and keep your certificates.</p>
      </div>



      <nav className="flex flex-wrap gap-3" aria-label="Learning navigation"><Button asChild variant={libraryView ? "outline" : "default"}><Link href="/me/courses">My Learning</Link></Button><Button asChild variant={libraryView ? "default" : "outline"}><Link href="/me/courses?view=library">Course Library</Link></Button><Button asChild variant="outline"><Link href="/me/certificates">My Certificates</Link></Button></nav>
      {!libraryView && !isLoading && !assignmentsError && !requiredAssignments.isError && <Card><CardHeader><CardTitle>{nextRequired ? "Your next required course" : required.length ? "Required learning progress" : "Welcome to your learning account"}</CardTitle></CardHeader><CardContent className="space-y-2">
        <p>{required.filter(a => a.status === "completed").length} / {required.length} required courses completed</p>
        {nextRequired ? <><p className="font-semibold">{courseById.get(nextRequired.course_id)?.title || "Assigned course"}</p><p>{nextRequired.due_date ? `Due ${formatDateForDisplay(nextRequired.due_date)} · ${formatDueDistance(nextRequired.due_date)}` : "No deadline set"}</p><Button asChild><Link href={`/me/courses/${nextRequired.id}`}>{actionLabel(nextRequired.status)} required course</Link></Button></> : <p>{required.length ? "Review your history below or explore the Course Library." : "Your facility has not assigned required courses yet. You can explore the Course Library while you wait."}</p>}
      </CardContent></Card>}
      {!libraryView && <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5" />
            {learningTab === "required" ? "Required by your facility" : learningTab === "optional" ? "Your optional learning" : "Completed learning and history"} {!isLoading && `(${filtered.length})`}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 flex-wrap" aria-label="Learning lists">{["required", "optional", "history"].map(value => <Button key={value} variant={learningTab === value ? "default" : "outline"} onClick={() => { setLearningTab(value); setStatusFilter("all"); }}>{value === "history" ? "Completed / history" : value === "required" ? "Required" : "Optional"}</Button>)}</div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44" aria-label="Status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="assigned">Assigned</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
              <SelectItem value="completed">Completed</SelectItem><SelectItem value="paused">Paused</SelectItem><SelectItem value="canceled">Canceled</SelectItem>
            </SelectContent>
          </Select>

          {employeeQuery.isError ? (
            <QueryError what="your training profile" error={employeeQuery.error} onRetry={() => void employeeQuery.refetch()} />
          ) : requiredAssignments.isError ? (<QueryError what="required learning" error={requiredAssignments.error} onRetry={() => void requiredAssignments.refetch()} />) : assignmentsError ? (
            <QueryError what="your assigned training" error={assignmentsErrorDetail} onRetry={() => refetchAssignments()} />
          ) : isLoading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />)}
            </div>
          ) : sorted.length === 0 ? (
            <div className="space-y-3 py-8 text-center">
              <p className="text-muted-foreground text-sm">
                {statusFilter === "all"
                  ? "No courses in this view. Explore the Course Library for optional learning, or ask your facility administrator about required assignments."
                  : "No training matches this status filter."}
              </p>
              {statusFilter !== "all" && (
                <Button size="sm" variant="outline" onClick={() => setStatusFilter("all")}>
                  Show all statuses
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {sorted.map(a => {
                const course = courseById.get(a.course_id);
                // Urgency only matters while the work is still open -- a completed training item's old
                // due date shouldn't shout "overdue."
                const dueDistance = !isClosedCourseAssignmentStatus(a.status) ? formatDueDistance(a.due_date) : null;
                const daysLeft = facilityDaysUntil(a.due_date);
                const dueTone =
                  daysLeft !== null && daysLeft < 0
                    ? "text-destructive font-medium"
                    : daysLeft !== null && daysLeft <= 7
                      ? "text-amber-600 font-medium"
                      : "";
                return (
                  <div key={a.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border">
                    <div className="min-w-0">
                      <p className="font-medium">{course?.title ?? "Training item"}</p>
                      <p className="text-xs text-muted-foreground">{a.is_required === false ? (a.assignment_origin === "self_enrolled" ? "You chose this course" : "Optional learning") : "Required by your facility"}{a.training_plan_id ? ` · ${planNames.data?.find(p => p.id === a.training_plan_id)?.name || "Learning plan"}` : ""}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.due_date ? `Due ${formatDateForDisplay(a.due_date)}` : "No due date"}
                        {dueDistance && <span className={dueTone}> · {dueDistance}</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={a.status} />
                      {user?.role === "employee" && !isClosedCourseAssignmentStatus(a.status) && <Button size="sm" variant="outline" disabled={downloadOffline.isPending || offlineLibrary.data?.some((item) => item.assignmentId === a.id)} onClick={() => downloadOffline.mutate({ assignmentId: a.id, title: course?.title ?? "Training item" }, { onSuccess: () => toast({ title: "Course encrypted for offline use" }), onError: (error) => toast({ title: "Course could not be downloaded", description: error.message, variant: "destructive" }) })}>{downloadOffline.isPending && downloadOffline.variables?.assignmentId === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudDownload className="h-4 w-4" />}<span className="sr-only">Download for offline use</span></Button>}
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
      </Card>}

      {libraryView && <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Course Library {!coursesReadyLoading && `(${visibleCourses.length})`}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid sm:grid-cols-2 gap-3"><label>Find a course<Input value={catalogSearch} onChange={e => setCatalogSearch(e.target.value)} placeholder="Title or description" /></label><label>Category<select className="w-full rounded border p-2" value={category} onChange={e => setCategory(e.target.value)}><option value="">All categories</option>{[...new Set(availableCourses.flatMap(c => c.category ? [c.category] : []))].sort().map(value => <option key={value}>{value}</option>)}</select></label></div>
          {coursesError ? (
            <QueryError what="available training" error={coursesErrorDetail} onRetry={() => refetchCourses()} />
          ) : currentVersionsQuery.isError ? (
            <QueryError what="available training versions" error={currentVersionsQuery.error} onRetry={() => void currentVersionsQuery.refetch()} />
          ) : coursesReadyLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />)}
            </div>
          ) : visibleCourses.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">
              No other published training items to start right now.
            </p>
          ) : (
            visibleCourses.map(course => (
              <div key={course.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border">
                <div className="min-w-0">
                  <p className="font-medium truncate">{course.title}</p>
                  <p className="text-xs text-muted-foreground">{course.category ?? "Uncategorized"} · {course.estimated_duration_minutes || "Duration not listed"}{course.estimated_duration_minutes ? " minutes" : ""}</p><details className="text-sm mt-2"><summary className="cursor-pointer underline">Course details</summary><p className="whitespace-pre-line">{course.description || "Ask your facility administrator for details about this course."}</p><p className="text-xs mt-2">Optional learning does not change your required completion. Captions and transcripts, when supplied with the course, are available in the player.</p></details>
                </div>
                <Button
                  size="sm"
                  disabled={enrolling && enrollingCourseId === course.id}
                  onClick={() => {
                    const existing = allAssignments.find(a => a.course_id === course.id && !["completed", "canceled"].includes(a.status))
                      || (!canSelfEnrollInCourse(course, allAssignments) ? allAssignments.find(a => a.course_id === course.id && a.status === "completed") : undefined);
                    if (existing) navigate(`/me/courses/${existing.id}`); else handleStart(course.id);
                  }}
                >
                  {enrolling && enrollingCourseId === course.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : allAssignments.some(a => a.course_id === course.id && !["completed", "canceled"].includes(a.status)) ? (<>Continue <ChevronRight className="h-4 w-4" /></>) : !canSelfEnrollInCourse(course, allAssignments) ? (<>Review <ChevronRight className="h-4 w-4" /></>) : allAssignments.some(a => a.course_id === course.id && a.status === "completed") ? (
                    <>Retake <ChevronRight className="h-4 w-4" /></>
                  ) : (
                    <>Start <ChevronRight className="h-4 w-4" /></>
                  )}
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>}
      {user?.role === "employee" && <details><summary className="cursor-pointer font-medium">Downloaded courses and device settings</summary><Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><HardDrive className="h-5 w-5" />Offline training library ({offlineLibrary.isLoading || offlineLibrary.isError ? "—" : (offlineLibrary.data?.length ?? 0)})</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Alert><ShieldCheck className="h-4 w-4" /><AlertTitle>Encrypted on this device</AlertTitle><AlertDescription>Only assigned course content and quiz prompts are cached. Answer keys, resident data, personnel lists, credentials, reports, and access tokens are excluded. Downloads expire after 30 days and are wiped when this device registration is revoked.</AlertDescription></Alert>
          {offlineLibrary.isError ? (
            <QueryError what="offline training library" error={offlineLibrary.error} onRetry={() => void offlineLibrary.refetch()} />
          ) : offlineLibrary.isLoading ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Loading offline library…</p>
          ) : offlineLibrary.data?.length ? offlineLibrary.data.map((item) => <div key={item.assignmentId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><p className="font-medium">{item.title}</p><p className="text-xs text-muted-foreground">Downloaded {new Date(item.downloadedAt).toLocaleString()} · expires {new Date(item.expiresAt).toLocaleDateString()}</p></div><div className="flex gap-2"><Button asChild size="sm" variant="outline"><Link href={`/me/courses/${item.assignmentId}/offline`}>Open offline copy</Link></Button><Button size="icon" variant="ghost" aria-label={`Remove offline copy of ${item.title}`} disabled={removeOffline.isPending} onClick={() => removeOffline.mutate(item.assignmentId, { onSuccess: () => toast({ title: "Offline copy removed" }), onError: (error) => toast({ title: "Offline copy could not be removed", description: error.message, variant: "destructive" }) })}><Trash2 className="h-4 w-4" /></Button></div></div>) : <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No courses are available offline yet. Use Download on an active assignment below.</p>}
          {!offlineLibrary.isLoading && !offlineLibrary.isError && (offlineLibrary.data?.length ?? 0) > 0 && <Button variant="outline" disabled={wipeOffline.isPending} onClick={() => wipeOffline.mutate(undefined, { onSuccess: () => toast({ title: "Offline training wiped from this device" }), onError: (error) => toast({ title: "Offline library could not be wiped", description: error.message, variant: "destructive" }) })}><Trash2 className="mr-2 h-4 w-4" />Revoke device and wipe all</Button>}
        </CardContent>
      </Card></details>}
    </div>
  );
}
