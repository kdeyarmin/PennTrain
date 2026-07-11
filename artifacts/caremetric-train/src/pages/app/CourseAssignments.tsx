import { useMemo, useState } from "react";
import { formatDateForDisplay } from "@/lib/dateUtils";
import {
  useListCourseAssignmentsPaginated,
  useCreateCourseAssignment,
  useCompleteCourseAssignment,
  useGetCourseProgress,
  type CourseAssignment,
} from "@/hooks/useCourseAssignments";
import { useListEmployees, type Employee } from "@/hooks/useEmployees";
import {
  useListCourses,
  useListCourseVersions,
  useListCourseVersionsForCourses,
  isCourseVersionLearnerReady,
} from "@/hooks/useCourses";
import { useListFacilities } from "@/hooks/useFacilities";
import { useIssueCertificate, useListCertificates, useGenerateCertificatePdf } from "@/hooks/useCertificates";
import { summarizeCourseAssignmentAnalytics } from "@/lib/courseAssignmentAnalytics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ClipboardList, Search, ChevronLeft, ChevronRight, UserPlus, CheckCircle2, Download, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

const PAGE_SIZE = 15;

const STATUS_OPTIONS = ["assigned", "in_progress", "completed", "overdue"] as const;

function humanize(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
}

function StatusPill({ status }: { status: string }) {
  const className =
    status === "completed"
      ? "bg-success text-success-foreground hover:bg-success/80"
      : status === "overdue"
        ? "bg-destructive text-destructive-foreground hover:bg-destructive/80"
        : status === "in_progress"
          ? "bg-info text-info-foreground hover:bg-info/80"
          : "bg-secondary text-secondary-foreground hover:bg-secondary/80";
  return (
    <Badge className={className} variant="outline">
      {humanize(status)}
    </Badge>
  );
}

interface AssignFormData {
  courseId: string;
  /** "" means "use the course's current_version_id" -- see handleAssign. */
  courseVersionId: string;
  dueDate: string;
}

const EMPTY_ASSIGN_FORM: AssignFormData = {
  courseId: "",
  courseVersionId: "",
  dueDate: "",
};

// ---------------------------------------------------------------------------
// Progress design note
//
// course_assignments can run into the thousands for a mid-size org (employees
// x courses x renewal cycles), so this list is fetched one page at a time via
// useListCourseAssignmentsPaginated's server-side .range() (see
// useCourseAssignments.ts) rather than downloading the full filtered set.
// Firing one useGetCourseProgress query per visible row would still re-fan-out
// on every page for a query that most rows don't need looked at, so the main
// table only shows `status` and `due_date`, which already answers "is this
// done, and by when" for the common case. Detailed percent-complete is
// available on demand: clicking "Progress" opens a small dialog that fetches
// course_progress for just that one assignment_id, so at most one extra
// query is in flight at a time.
// ---------------------------------------------------------------------------
function ProgressDialog({ assignmentId, onClose }: { assignmentId: string | null; onClose: () => void }) {
  const { data: progress, isLoading } = useGetCourseProgress(assignmentId ?? undefined);

  return (
    <Dialog open={!!assignmentId} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Course Progress</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="h-16 bg-muted animate-pulse rounded" />
        ) : progress ? (
          <div className="space-y-3 py-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Percent Complete</span>
              <span className="font-medium">{progress.percent_complete}%</span>
            </div>
            <Progress value={progress.percent_complete} />
            <div className="text-xs text-muted-foreground">
              {progress.started_at
                ? `Started ${new Date(progress.started_at).toLocaleDateString()}`
                : "Not started yet"}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">No progress recorded yet.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function CourseAssignments() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [facilityId, setFacilityId] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [assignForm, setAssignForm] = useState<AssignFormData>(EMPTY_ASSIGN_FORM);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(new Set());
  const [assignFacilityFilter, setAssignFacilityFilter] = useState<string>("all");
  const [assigning, setAssigning] = useState(false);
  const [progressAssignmentId, setProgressAssignmentId] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [downloadingCertId, setDownloadingCertId] = useState<string | null>(null);

  // RLS also lets an employee complete their own assignment, but that
  // self-service path lives on the learner-facing page -- this admin view
  // only exposes "Mark Complete" to non-employee managing roles.
  const canManage = ["org_admin", "facility_manager", "trainer"].includes(user?.role ?? "");

  const { data: facilities } = useListFacilities();
  const { data: employees } = useListEmployees();
  const { data: courses } = useListCourses();
  const courseIds = useMemo(() => (courses ?? []).map(c => c.id), [courses]);
  const { data: allCourseVersions } = useListCourseVersionsForCourses(courseIds);
  const { data: courseVersions } = useListCourseVersions(assignForm.courseId || undefined);

  const { mutateAsync: createAssignmentAsync } = useCreateCourseAssignment();
  const { mutate: completeAssignment, isPending: completing } = useCompleteCourseAssignment();
  const { mutate: issueCertificate } = useIssueCertificate();
  // Unfiltered on purpose -- RLS (certificates_select) already scopes this to certificates the
  // current caller is allowed to see (their own, or org/facility staff), the same population this
  // page's own assignments query is implicitly scoped to. Mirrors the "fetch full set, look up
  // client-side" approach already used for facilities/employees/courses on this page.
  const { data: certificates } = useListCertificates();
  const { mutateAsync: generateCertPdf } = useGenerateCertificatePdf();

  const employeeById = useMemo(() => new Map((employees ?? []).map(e => [e.id, e])), [employees]);
  const courseById = useMemo(() => new Map((courses ?? []).map(c => [c.id, c])), [courses]);
  // certificates.course_assignment_id is the direct link from an issued certificate back to the
  // assignment that earned it -- lets each row look up "is there already a certificate for this
  // completed assignment" without a per-row fetch.
  const certificateByAssignmentId = useMemo(
    () => new Map((certificates ?? []).filter(c => c.course_assignment_id).map(c => [c.course_assignment_id as string, c])),
    [certificates],
  );

  const activeEmployees = useMemo(
    () =>
      (employees ?? [])
        .filter(e => e.status === "active")
        .sort((a, b) => `${a.last_name}${a.first_name}`.localeCompare(`${b.last_name}${b.first_name}`)),
    [employees],
  );
  const learnerReadyVersionsByCourseId = useMemo(() => {
    type CourseVersionRows = NonNullable<typeof allCourseVersions>;
    const map = new Map<string, CourseVersionRows>();
    for (const version of allCourseVersions ?? []) {
      if (!isCourseVersionLearnerReady(version)) continue;
      const list = map.get(version.course_id) ?? [];
      list.push(version);
      map.set(version.course_id, list);
    }
    return map;
  }, [allCourseVersions]);

  // Only courses with at least one published, learner-ready version are worth assigning. This
  // keeps managers from selecting a catalog-published course whose current version is still a
  // draft or whose AI-generated content has not completed the required review.
  const publishedCourses = useMemo(
    () =>
      (courses ?? []).filter(
        c => c.status === "published" && (learnerReadyVersionsByCourseId.get(c.id)?.length ?? 0) > 0,
      ),
    [courses, learnerReadyVersionsByCourseId],
  );

  const selectedCourse = assignForm.courseId ? courseById.get(assignForm.courseId) : undefined;
  // Assignments pin to a specific published version. Only offer the picker when
  // more than one published version exists; otherwise silently default to
  // current_version_id in handleAssign.
  const publishedVersions = useMemo(
    () => (courseVersions ?? []).filter(isCourseVersionLearnerReady),
    [courseVersions],
  );
  const showVersionPicker = publishedVersions.length > 1;
  const defaultVersion = useMemo(
    () => publishedVersions.find(v => v.id === selectedCourse?.current_version_id) ?? publishedVersions[publishedVersions.length - 1],
    [publishedVersions, selectedCourse?.current_version_id],
  );

  // course_assignments has no employee-name/course-title columns of its own, so the free-text
  // search box is resolved against the employees/courses lists above (already loaded, and
  // inherently bounded by org headcount/catalog size, unlike course_assignments) into id lists the
  // paginated query below filters by -- see useListCourseAssignmentsPaginated.
  const trimmedSearch = search.trim().toLowerCase();
  const matchingEmployeeIds = useMemo(() => {
    if (!trimmedSearch) return undefined;
    return (employees ?? [])
      .filter(e => `${e.first_name} ${e.last_name}`.toLowerCase().includes(trimmedSearch))
      .map(e => e.id);
  }, [employees, trimmedSearch]);
  const matchingCourseIds = useMemo(() => {
    if (!trimmedSearch) return undefined;
    return (courses ?? [])
      .filter(c => c.title.toLowerCase().includes(trimmedSearch))
      .map(c => c.id);
  }, [courses, trimmedSearch]);

  const { data: assignmentsPage, isLoading } = useListCourseAssignmentsPaginated({
    facilityId: facilityId !== "all" ? facilityId : undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    matchingEmployeeIds,
    matchingCourseIds,
    page,
    pageSize: PAGE_SIZE,
  });
  const paginated = assignmentsPage?.rows ?? [];
  const totalCount = assignmentsPage?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const assignmentSummary = useMemo(() => summarizeCourseAssignmentAnalytics(
    paginated.map(a => ({
      id: a.id,
      status: a.status,
      due_date: a.due_date,
      completed_at: a.completed_at,
    })),
    new Date().toISOString().slice(0, 10),
  ), [paginated]);

  // Employees offered in the assign dialog's multi-select, narrowed by that dialog's own facility
  // filter (assignFacilityFilter) -- independent of the page-level facilityId filter above.
  const filteredAssignEmployees = useMemo(
    () => activeEmployees.filter(e => assignFacilityFilter === "all" || e.facility_id === assignFacilityFilter),
    [activeEmployees, assignFacilityFilter],
  );
  const allFilteredSelected = filteredAssignEmployees.length > 0 && filteredAssignEmployees.every(e => selectedEmployeeIds.has(e.id));
  const someFilteredSelected = filteredAssignEmployees.some(e => selectedEmployeeIds.has(e.id));

  const toggleEmployee = (id: string) => {
    setSelectedEmployeeIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // "Select all in facility" convenience -- toggles every currently-filtered employee at once
  // (tri-state: selects all if any are unselected, clears all if every filtered employee is
  // already selected).
  const toggleSelectAllFiltered = () => {
    setSelectedEmployeeIds(prev => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const e of filteredAssignEmployees) next.delete(e.id);
      } else {
        for (const e of filteredAssignEmployees) next.add(e.id);
      }
      return next;
    });
  };

  const openAssign = () => {
    setAssignForm(EMPTY_ASSIGN_FORM);
    setSelectedEmployeeIds(new Set());
    setAssignFacilityFilter("all");
    setShowAssignForm(true);
  };

  const handleCourseChange = (courseId: string) => {
    setAssignForm(f => ({ ...f, courseId, courseVersionId: "" }));
  };

  const field = (k: keyof AssignFormData, v: string) => setAssignForm(f => ({ ...f, [k]: v }));

  // Assigns the selected course to every selected employee in one batch via Promise.allSettled
  // (mirrors CourseDetail.tsx's handleGenerateAllVideos bulk pattern) so one employee's failure
  // doesn't stop the rest, then reports one summary toast instead of one per employee.
  const handleAssign = async () => {
    if (selectedEmployeeIds.size === 0 || !assignForm.courseId) {
      toast({ title: "Select at least one employee and a course", variant: "destructive" });
      return;
    }
    const course = courseById.get(assignForm.courseId);
    // Captured as plain local consts (rather than referencing user.organizationId/user.id
    // directly inside the .map() closure below) so the narrowing from this guard unambiguously
    // survives into that nested closure.
    const organizationId = user?.organizationId;
    const assignedBy = user?.id;
    if (!course || !organizationId || !assignedBy) return;

    const versionId = assignForm.courseVersionId || defaultVersion?.id;
    if (!versionId) {
      toast({ title: "This course has no published version to assign", variant: "destructive" });
      return;
    }
    const courseId = course.id;

    const targetEmployees = [...selectedEmployeeIds]
      .map(id => employeeById.get(id))
      .filter((e): e is Employee => !!e);

    setAssigning(true);
    const results = await Promise.allSettled(
      targetEmployees.map(employee =>
        createAssignmentAsync({
          employee_id: employee.id,
          course_id: courseId,
          course_version_id: versionId,
          facility_id: employee.facility_id,
          organization_id: organizationId,
          due_date: assignForm.dueDate || null,
          assigned_by: assignedBy,
        }),
      ),
    );
    setAssigning(false);

    const succeeded = results.filter(r => r.status === "fulfilled").length;
    const failed = results.length - succeeded;
    toast({
      title: failed === 0 ? "Course assigned" : succeeded === 0 ? "Failed to assign course" : "Course partially assigned",
      description:
        `${succeeded} of ${results.length} employee${results.length === 1 ? "" : "s"} assigned successfully.`
        + (failed > 0 ? ` ${failed} failed.` : ""),
      variant: failed === 0 ? "success" : succeeded === 0 ? "destructive" : undefined,
    });

    if (succeeded > 0) {
      setShowAssignForm(false);
      setAssignForm(EMPTY_ASSIGN_FORM);
      setSelectedEmployeeIds(new Set());
    }
  };

  const handleComplete = (assignment: CourseAssignment) => {
    setCompletingId(assignment.id);
    completeAssignment(assignment.id, {
      onSuccess: () => {
        toast({ title: "Marked complete" });
        issueCertificate(
          { employeeId: assignment.employee_id, courseId: assignment.course_id, assignmentId: assignment.id },
          {
            onError: (e: Error) =>
              // Completion already succeeded; a failed issuance (e.g. one already exists for this
              // assignment) shouldn't read as a failure of the "Mark Complete" action itself.
              console.error("issue_certificate failed after marking assignment complete:", e.message),
          }
        );
      },
      onError: (e: Error) => toast({ title: "Failed to mark complete", description: e.message, variant: "destructive" }),
      onSettled: () => setCompletingId(null),
    });
  };

  const handleDownloadCertificate = async (certificateId: string) => {
    setDownloadingCertId(certificateId);
    try {
      const { url } = await generateCertPdf(certificateId);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast({
        title: "Could not generate certificate PDF",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setDownloadingCertId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="page-header flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1>Course Assignments</h1>
          <p>Assign courses to employees and track completion.</p>
        </div>
        {canManage && (
          <Button onClick={openAssign} className="shadow-sm">
            <UserPlus className="mr-2 h-4 w-4" /> Assign Course
          </Button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="premium-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Visible completion</p>
          <p className="mt-1 text-2xl font-semibold">{assignmentSummary.completionRate}%</p>
          <p className="mt-1 text-xs text-muted-foreground">{assignmentSummary.completed} of {assignmentSummary.total} on this page complete.</p>
        </div>
        <button type="button" className="premium-card p-4 text-left hover:border-destructive/40" onClick={() => { setStatusFilter("overdue"); setPage(1); }}>
          <p className="text-xs font-medium text-muted-foreground">Overdue on page</p>
          <p className="mt-1 text-2xl font-semibold text-destructive">{assignmentSummary.overdue}</p>
          <p className="mt-1 text-xs text-muted-foreground">Click to filter all overdue assignments.</p>
        </button>
        <div className="premium-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Due within 7 days</p>
          <p className="mt-1 text-2xl font-semibold">{assignmentSummary.dueWithin7Days}</p>
          <p className="mt-1 text-xs text-muted-foreground">{assignmentSummary.inProgress} in progress · {assignmentSummary.assigned} not started</p>
        </div>
        <div className="premium-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Oldest overdue</p>
          <p className="mt-1 text-lg font-semibold">
            {assignmentSummary.oldestOverdueAssignmentId ? "Needs follow-up" : "—"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {assignmentSummary.oldestOverdueAssignmentId ? (
              <button type="button" className="text-primary hover:underline" onClick={() => setProgressAssignmentId(assignmentSummary.oldestOverdueAssignmentId)}>
                Open progress details
              </button>
            ) : "No overdue assignments on this page."}
          </p>
        </div>
      </div>

      <div className="premium-card">
        <div className="filter-bar">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by employee or course..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="pl-9 h-9 bg-card"
            />
          </div>
          <Select value={facilityId} onValueChange={v => { setFacilityId(v); setPage(1); }}>
            <SelectTrigger className="w-48 h-9 bg-card">
              <SelectValue placeholder="All Facilities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Facilities</SelectItem>
              {facilities?.map(f => (
                <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-40 h-9 bg-card">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {STATUS_OPTIONS.map(s => (
                <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="p-6 space-y-3">
            {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />)}
          </div>
        ) : paginated.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <ClipboardList className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No course assignments found</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Try adjusting your search or filters</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data-table min-w-[720px]">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Course</th>
                    <th>Status</th>
                    <th>Due Date</th>
                    <th>Completed</th>
                    <th className="w-44" />
                  </tr>
                </thead>
                <tbody>
                  {paginated.map(a => {
                    const emp = employeeById.get(a.employee_id);
                    const course = courseById.get(a.course_id);
                    const cert = certificateByAssignmentId.get(a.id);
                    return (
                      <tr key={a.id}>
                        <td>
                          <span className="font-medium text-foreground">
                            {emp ? `${emp.last_name}, ${emp.first_name}` : `Employee #${a.employee_id.slice(0, 8)}`}
                          </span>
                        </td>
                        <td className="text-muted-foreground">
                          {course?.title ?? `Course #${a.course_id.slice(0, 8)}`}
                        </td>
                        <td>
                          <StatusPill status={a.status} />
                        </td>
                        <td className="text-muted-foreground">
                          {formatDateForDisplay(a.due_date)}
                        </td>
                        <td className="text-muted-foreground">
                          {a.completed_at ? new Date(a.completed_at).toLocaleDateString() : "—"}
                        </td>
                        <td>
                          <div className="flex items-center gap-1.5 justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 text-xs text-muted-foreground hover:text-foreground"
                              onClick={() => setProgressAssignmentId(a.id)}
                            >
                              Progress
                            </Button>
                            {cert && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 text-xs text-muted-foreground hover:text-foreground"
                                onClick={() => handleDownloadCertificate(cert.id)}
                                disabled={downloadingCertId === cert.id}
                              >
                                {downloadingCertId === cert.id ? (
                                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Download className="mr-1 h-3.5 w-3.5" />
                                )}
                                {downloadingCertId === cert.id ? "Preparing..." : "Certificate"}
                              </Button>
                            )}
                            {canManage && a.status !== "completed" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 text-xs text-muted-foreground hover:text-foreground"
                                onClick={() => handleComplete(a)}
                                disabled={completing && completingId === a.id}
                              >
                                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                                {completing && completingId === a.id ? "Completing..." : "Mark Complete"}
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-5 py-4 border-t border-border/60">
              <p className="text-[13px] text-muted-foreground">
                Showing{" "}
                <span className="font-medium text-foreground">
                  {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalCount)}
                </span>{" "}
                of {totalCount}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-8" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-[13px] text-muted-foreground px-2">Page {page} of {totalPages}</span>
                <Button variant="outline" size="sm" className="h-8" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <ClipboardList className="h-4 w-4" />
        <span>{totalCount} assignment{totalCount !== 1 ? "s" : ""} total</span>
      </div>

      <Dialog open={showAssignForm} onOpenChange={o => { if (!o) setShowAssignForm(false); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Assign Course</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-[13px]">Course *</Label>
              <Select value={assignForm.courseId} onValueChange={handleCourseChange}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select course" /></SelectTrigger>
                <SelectContent>
                  {publishedCourses.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {showVersionPicker && (
              <div className="space-y-1.5">
                <Label className="text-[13px]">Version</Label>
                <Select
                  value={assignForm.courseVersionId || "default"}
                  onValueChange={v => field("courseVersionId", v === "default" ? "" : v)}
                >
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">
                      {defaultVersion
                        ? `Default: v${defaultVersion.version_number} - ${defaultVersion.title}`
                        : "No published version available"}
                    </SelectItem>
                    {publishedVersions.map(v => (
                      <SelectItem key={v.id} value={v.id}>
                        v{v.version_number} — {v.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-[13px]">Due Date</Label>
              <Input type="date" value={assignForm.dueDate} onChange={e => field("dueDate", e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-[13px]">Employees * ({selectedEmployeeIds.size} selected)</Label>
                <Select value={assignFacilityFilter} onValueChange={setAssignFacilityFilter}>
                  <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="All Facilities" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Facilities</SelectItem>
                    {facilities?.map(f => (
                      <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="border rounded-md overflow-hidden">
                <label className="flex items-center gap-2 px-2.5 py-1.5 text-xs border-b bg-muted/40 cursor-pointer">
                  <Checkbox
                    checked={allFilteredSelected ? true : someFilteredSelected ? "indeterminate" : false}
                    onCheckedChange={toggleSelectAllFiltered}
                    aria-label="Select all in facility"
                  />
                  <span className="text-muted-foreground">
                    Select all{assignFacilityFilter !== "all" ? " in this facility" : ""} ({filteredAssignEmployees.length})
                  </span>
                </label>
                <div className="max-h-52 overflow-y-auto divide-y">
                  {filteredAssignEmployees.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">
                      No active employees{assignFacilityFilter !== "all" ? " in this facility" : ""}.
                    </p>
                  ) : (
                    filteredAssignEmployees.map(e => (
                      <label key={e.id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm cursor-pointer hover:bg-muted/40">
                        <Checkbox
                          checked={selectedEmployeeIds.has(e.id)}
                          onCheckedChange={() => toggleEmployee(e.id)}
                        />
                        <span className="flex-1 truncate">{e.last_name}, {e.first_name}</span>
                        {e.job_title && <span className="text-xs text-muted-foreground truncate">{e.job_title}</span>}
                      </label>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssignForm(false)}>Cancel</Button>
            <Button
              onClick={handleAssign}
              disabled={assigning || selectedEmployeeIds.size === 0 || !assignForm.courseId || !defaultVersion}
              className="shadow-sm"
            >
              {assigning
                ? "Assigning..."
                : selectedEmployeeIds.size > 0
                  ? `Assign to ${selectedEmployeeIds.size} Employee${selectedEmployeeIds.size === 1 ? "" : "s"}`
                  : "Assign Course"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ProgressDialog assignmentId={progressAssignmentId} onClose={() => setProgressAssignmentId(null)} />
    </div>
  );
}
