import { useId, useEffect, useMemo, useState } from "react";
import { facilityToday, formatDateForDisplay } from "@/lib/dateUtils";
import {
  useListCourseAssignmentsPaginated,
  useCreateCourseAssignment,
  useCompleteCourseAssignment,
  useGetCourseProgress,
  useGrantAdditionalQuizAttempt,
  useCancelCourseAssignment,
  OPEN_ASSIGNMENT_STATUSES,
  type CourseAssignment,
} from "@/hooks/useCourseAssignments";
import { useListEmployees, type Employee } from "@/hooks/useEmployees";
import {
  useListCourses,
  useListCourseVersionsForCourses,
  isCourseVersionLearnerReady,
} from "@/hooks/useCourses";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListCertificates, usePrepareCertificatePdf } from "@/hooks/useCertificates";
import {
  describeBulkAssignment, summarizeBulkAssignment, summarizeCourseAssignmentAnalytics,
} from "@/lib/courseAssignmentAnalytics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { QueryError } from "@/components/QueryState";
import { ClipboardList, Search, ChevronLeft, ChevronRight, UserPlus, CheckCircle2, Download, Loader2, RotateCcw, Ban } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { openDocumentUrl } from "@/lib/openDocumentUrl";

const PAGE_SIZE = 15;

// `canceled` is here because this page can now produce one (see the cancel action below). Without
// it a cancelled assignment is unreachable from the filter bar -- it is excluded from every other
// status, so the manager who just cancelled it has no way to find it again.
const STATUS_OPTIONS = ["assigned", "in_progress", "completed", "overdue", "canceled"] as const;

/**
 * Both RPCs refuse a reason under 10 characters ("Say why ... -- at least a sentence",
 * 20260906130000). Enforcing the same floor here means the dialog says so before the round trip
 * instead of turning it into a red toast.
 */
const MIN_REASON = 10;

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
          : status === "canceled"
            ? "bg-muted text-muted-foreground hover:bg-muted/80"
            : "bg-secondary text-secondary-foreground hover:bg-secondary/80";
  return (
    <Badge className={className} variant="outline">
      {humanize(status)}
    </Badge>
  );
}

interface AssignFormData {
  courseId: string;
  dueDate: string;
}

const EMPTY_ASSIGN_FORM: AssignFormData = {
  courseId: "",
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
  const { data: progress, isLoading, isError, error, refetch } = useGetCourseProgress(assignmentId ?? undefined);

  return (
    <Dialog open={!!assignmentId} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Training Progress</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="h-16 bg-muted animate-pulse rounded" />
        ) : isError ? (
          <QueryError what="training progress" error={error} onRetry={() => void refetch()} />
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
  const __fieldIds = useId();
  const { user } = useAuth();
  const { toast } = useToast();

  const [facilityId, setFacilityId] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [assignForm, setAssignForm] = useState<AssignFormData>(EMPTY_ASSIGN_FORM);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(new Set());
  const [assignEmployeeSearch, setAssignEmployeeSearch] = useState("");
  const [assignFacilityFilter, setAssignFacilityFilter] = useState<string>("all");
  const [assigning, setAssigning] = useState(false);
  const [progressAssignmentId, setProgressAssignmentId] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [downloadingCertId, setDownloadingCertId] = useState<string | null>(null);
  const [selectedAssignmentIds, setSelectedAssignmentIds] = useState<Set<string>>(new Set());
  const [bulkCompleting, setBulkCompleting] = useState(false);
  // The unblock dialog (BACKLOG.md J2): one dialog, two intents, one required reason.
  const [unblock, setUnblock] = useState<{ mode: "grant" | "cancel"; assignment: CourseAssignment } | null>(null);
  const [unblockReason, setUnblockReason] = useState("");

  // RLS also lets an employee complete their own assignment, but that
  // self-service path lives on the employee training page -- this admin view
  // only exposes "Mark Complete" to non-employee managing roles.
  const canManage = ["org_admin", "facility_manager", "trainer"].includes(user?.role ?? "");
  // The two unblock actions below are security-definer RPCs, so they do NOT go through
  // course_assignments_update's `is_assigned_to_facility(facility_id)`. Both call
  // `assert_content_permission(organization_id, 'training.sessions.manage')` (20260906130000),
  // which is satisfied at ORGANIZATION scope -- and the role templates grant that key to
  // org_admin, facility_manager and trainer (20260711213000). So the same role predicate the rest
  // of this page uses is exactly the server's own rule here; narrowing further by facility
  // assignment would hide a control the database would have accepted.

  const { data: facilities } = useListFacilities();
  const { data: employees, isLoading: employeesLoading, isError: employeesError, error: employeesErr, refetch: refetchEmployees } = useListEmployees({ status: "active" });
  const { data: courses } = useListCourses();
  const courseIds = useMemo(() => (courses ?? []).map(c => c.id), [courses]);
  const {
    data: allCourseVersions,
    isLoading: courseVersionsLoading,
    isError: courseVersionsError,
  } = useListCourseVersionsForCourses(courseIds);

  const { mutateAsync: createAssignmentAsync } = useCreateCourseAssignment();
  const { mutate: completeAssignment, mutateAsync: completeAssignmentAsync, isPending: completing } = useCompleteCourseAssignment();
  const { mutateAsync: grantAttemptAsync, isPending: grantingAttempt } = useGrantAdditionalQuizAttempt();
  const { mutateAsync: cancelAssignmentAsync, isPending: cancelingAssignment } = useCancelCourseAssignment();
  // Unfiltered on purpose -- RLS (certificates_select) already scopes this to certificates the
  // current caller is allowed to see (their own, or org/facility staff), the same population this
  // page's own assignments query is implicitly scoped to. Mirrors the "fetch full set, look up
  // client-side" approach already used for facilities/employees/courses on this page.
  const { data: certificates } = useListCertificates();
  const { mutateAsync: prepareCertPdf } = usePrepareCertificatePdf();

  const employeeById = useMemo(() => new Map((employees ?? []).map(e => [e.id, e])), [employees]);
  const courseById = useMemo(() => new Map((courses ?? []).map(c => [c.id, c])), [courses]);
  const courseVersionById = useMemo(
    () => new Map((allCourseVersions ?? []).map(version => [version.id, version])),
    [allCourseVersions],
  );
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

  // New assignments always pin to the current version. Historical published
  // versions remain available only to assignments that already reference them.
  const publishedCourses = useMemo(
    () =>
      (courses ?? []).filter(
        c => c.status === "published"
          && !!c.current_version_id
          && (learnerReadyVersionsByCourseId.get(c.id) ?? [])
            .some(version => version.id === c.current_version_id),
      ),
    [courses, learnerReadyVersionsByCourseId],
  );

  const selectedCourse = assignForm.courseId ? courseById.get(assignForm.courseId) : undefined;
  const defaultVersion = useMemo(
    () => (learnerReadyVersionsByCourseId.get(selectedCourse?.id ?? "") ?? [])
      .find(version => version.id === selectedCourse?.current_version_id),
    [learnerReadyVersionsByCourseId, selectedCourse?.current_version_id, selectedCourse?.id],
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

  const {
    data: assignmentsPage,
    isLoading,
    isError: assignmentsError,
    error: assignmentsErrorDetail,
    refetch: refetchAssignments,
  } = useListCourseAssignmentsPaginated({
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
    facilityToday(),
  ), [paginated]);

  // Same eligibility gate as the single-row "Mark Complete" button -- not completed, version
  // metadata loaded, and not a comprehensive content_standard that requires learner evidence.
  const isEligibleForComplete = (a: CourseAssignment) => {
    if (a.status === "completed") return false;
    const assignmentVersion = courseVersionById.get(a.course_version_id);
    const versionMetadataReady =
      !courseVersionsLoading && !courseVersionsError && !!assignmentVersion;
    if (!versionMetadataReady) return false;
    if (assignmentVersion?.content_standard === "comprehensive") return false;
    return true;
  };

  const eligibleOnPage = useMemo(
    () => paginated.filter(isEligibleForComplete),
    // isEligibleForComplete closes over version maps that change with courseVersionsLoading
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paginated, courseVersionById, courseVersionsLoading, courseVersionsError],
  );
  const allEligibleSelected =
    eligibleOnPage.length > 0 && eligibleOnPage.every((a) => selectedAssignmentIds.has(a.id));
  const someEligibleSelected = eligibleOnPage.some((a) => selectedAssignmentIds.has(a.id));

  useEffect(() => {
    setSelectedAssignmentIds(new Set());
  }, [facilityId, statusFilter, search, page]);

  const toggleAssignment = (id: string) => {
    setSelectedAssignmentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllEligible = () => {
    setSelectedAssignmentIds((prev) => {
      const next = new Set(prev);
      if (allEligibleSelected) {
        for (const a of eligibleOnPage) next.delete(a.id);
      } else {
        for (const a of eligibleOnPage) next.add(a.id);
      }
      return next;
    });
  };

  // Employees offered in the assign dialog's multi-select, narrowed by that dialog's own facility
  // filter (assignFacilityFilter) -- independent of the page-level facilityId filter above.
  const filteredAssignEmployees = useMemo(() => {
    const needle = assignEmployeeSearch.trim().toLowerCase();
    return activeEmployees.filter((e) => {
      if (assignFacilityFilter !== "all" && e.facility_id !== assignFacilityFilter) return false;
      if (!needle) return true;
      return `${e.last_name} ${e.first_name} ${e.job_title ?? ""}`.toLowerCase().includes(needle);
    });
  }, [activeEmployees, assignFacilityFilter, assignEmployeeSearch]);
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
    setAssignEmployeeSearch("");
    setAssignFacilityFilter("all");
    setShowAssignForm(true);
  };

  const handleCourseChange = (courseId: string) => {
    setAssignForm(f => ({ ...f, courseId }));
  };

  const field = (k: keyof AssignFormData, v: string) => setAssignForm(f => ({ ...f, [k]: v }));

  // Assigns the selected course to every selected employee in one batch via Promise.allSettled
  // (mirrors CourseDetail.tsx's handleGenerateAllVideos bulk pattern) so one employee's failure
  // doesn't stop the rest, then reports one summary toast instead of one per employee.
  const handleAssign = async () => {
    if (selectedEmployeeIds.size === 0 || !assignForm.courseId) {
      toast({ title: "Select at least one employee and training item", variant: "destructive" });
      return;
    }
    const course = courseById.get(assignForm.courseId);
    // Captured as plain local consts (rather than referencing user.organizationId/user.id
    // directly inside the .map() closure below) so the narrowing from this guard unambiguously
    // survives into that nested closure.
    const organizationId = user?.organizationId;
    const assignedBy = user?.id;
    if (!course || !organizationId || !assignedBy) return;

    const versionId = defaultVersion?.id;
    if (!versionId) {
      toast({ title: "This training item has no published version to assign", variant: "destructive" });
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

    // Three outcomes, not two: re-assigning the annual course to everyone is a normal thing to do,
    // and most of the list will already have it. See summarizeBulkAssignment for why folding those
    // into either of the other two counts gets the toast wrong.
    const outcome = summarizeBulkAssignment(
      results.map(r => ({
        status: r.status,
        alreadyAssigned: r.status === "fulfilled" ? r.value.alreadyAssigned : undefined,
      })),
    );
    const fulfilledCount = outcome.assigned + outcome.alreadyAssigned;
    toast({
      title: outcome.failed === 0
        ? (outcome.assigned === 0 && outcome.alreadyAssigned > 0
          ? "Everyone already had this training"
          : "Training assigned")
        : fulfilledCount === 0 ? "Failed to assign training" : "Training partially assigned",
      description: describeBulkAssignment(outcome),
      variant: outcome.failed === 0 ? "success" : fulfilledCount === 0 ? "destructive" : undefined,
    });

    if (fulfilledCount > 0) {
      setShowAssignForm(false);
      setAssignForm(EMPTY_ASSIGN_FORM);
      setSelectedEmployeeIds(new Set());
    }
  };

  const handleComplete = (assignment: CourseAssignment) => {
    setCompletingId(assignment.id);
    completeAssignment(assignment.id, {
      onSuccess: () => {
        // The completion RPC now commits the assignment, compliance documentation, certificate,
        // lifecycle event, and PDF job together. There is deliberately no second issuance call.
        toast({ title: "Marked complete", description: "Certificate issued and PDF preparation queued." });
        setSelectedAssignmentIds((prev) => {
          const next = new Set(prev);
          next.delete(assignment.id);
          return next;
        });
      },
      onError: (e: Error) => toast({ title: "Failed to mark complete", description: e.message, variant: "destructive" }),
      onSettled: () => setCompletingId(null),
    });
  };

  const handleBulkComplete = async () => {
    if (selectedAssignmentIds.size === 0) return;
    const ids = Array.from(selectedAssignmentIds);
    setBulkCompleting(true);
    const results = await Promise.allSettled(
      ids.map((id) => completeAssignmentAsync(id)),
    );
    setBulkCompleting(false);

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - succeeded;
    toast({
      title:
        failed === 0
          ? `${succeeded} assignment${succeeded === 1 ? "" : "s"} marked complete`
          : succeeded === 0
            ? "Bulk mark complete failed"
            : "Bulk mark complete partially completed",
      description:
        failed > 0
          ? `${succeeded} of ${results.length} completed. ${failed} failed.`
          : "Certificates issued and PDF preparation queued.",
      variant: failed === 0 ? "success" : succeeded === 0 ? "destructive" : undefined,
    });

    if (succeeded > 0) setSelectedAssignmentIds(new Set());
  };

  const openUnblock = (mode: "grant" | "cancel", assignment: CourseAssignment) => {
    setUnblock({ mode, assignment });
    setUnblockReason("");
  };

  // Both halves of the way out of an exhausted final assessment (BACKLOG.md J2). Grant is the
  // narrow repair -- one more attempt on the same assignment. Cancel is the broad one: it releases
  // course_assignments_one_open_per_course_idx so the same course can be assigned again, which is
  // the only way to restart a learner who is past repairing on the existing row.
  const submitUnblock = async () => {
    if (!unblock) return;
    const reason = unblockReason.trim();
    if (reason.length < MIN_REASON) return;
    const { mode, assignment } = unblock;
    try {
      if (mode === "grant") {
        await grantAttemptAsync({ assignmentId: assignment.id, reason });
        toast({
          title: "Additional attempt granted",
          description: "The learner can retake the assessment from My Training.",
          variant: "success",
        });
      } else {
        await cancelAssignmentAsync({ assignmentId: assignment.id, reason });
        toast({
          title: "Assignment canceled",
          description: "This course can now be assigned to this employee again.",
          variant: "success",
        });
        setSelectedAssignmentIds(prev => {
          const next = new Set(prev);
          next.delete(assignment.id);
          return next;
        });
      }
      setUnblock(null);
      setUnblockReason("");
    } catch (error) {
      toast({
        title: mode === "grant" ? "Could not grant another attempt" : "Could not cancel assignment",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  const handleDownloadCertificate = async (certificateId: string) => {
    setDownloadingCertId(certificateId);
    try {
      const { url } = await prepareCertPdf(certificateId);
      openDocumentUrl(url);
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
          <h1>Training Assignments</h1>
          <p>Assign required training to employees and track completion.</p>
        </div>
        {canManage && (
          <Button onClick={openAssign} className="shadow-sm">
            <UserPlus className="mr-2 h-4 w-4" /> Assign Training
          </Button>
        )}
      </div>

      {!assignmentsError && (
        <div className="grid gap-4 md:grid-cols-4">
          <div className="premium-card p-4">
            <p className="text-xs font-medium text-muted-foreground">Visible completion</p>
            <p className="mt-1 text-2xl font-semibold">{isLoading ? "—" : `${assignmentSummary.completionRate}%`}</p>
            <p className="mt-1 text-xs text-muted-foreground">{isLoading ? "Loading this page…" : `${assignmentSummary.completed} of ${assignmentSummary.total} on this page complete.`}</p>
          </div>
          <button type="button" className="premium-card p-4 text-left hover:border-destructive/40" onClick={() => { setStatusFilter("overdue"); setPage(1); }}>
            <p className="text-xs font-medium text-muted-foreground">Overdue on page</p>
            <p className={`mt-1 text-2xl font-semibold ${isLoading ? "" : "text-destructive"}`}>{isLoading ? "—" : assignmentSummary.overdue}</p>
            <p className="mt-1 text-xs text-muted-foreground">Click to filter all overdue assignments.</p>
          </button>
          <div className="premium-card p-4">
            <p className="text-xs font-medium text-muted-foreground">Due within 7 days</p>
            <p className="mt-1 text-2xl font-semibold">{isLoading ? "—" : assignmentSummary.dueWithin7Days}</p>
            <p className="mt-1 text-xs text-muted-foreground">{isLoading ? "Loading this page…" : `${assignmentSummary.inProgress} in progress · ${assignmentSummary.assigned} not started`}</p>
          </div>
          <div className="premium-card p-4">
            <p className="text-xs font-medium text-muted-foreground">Oldest overdue</p>
            <p className="mt-1 text-lg font-semibold">
              {isLoading ? "—" : assignmentSummary.oldestOverdueAssignmentId ? "Needs follow-up" : "—"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {isLoading ? "Loading this page…" : assignmentSummary.oldestOverdueAssignmentId ? (
                <button type="button" className="text-primary hover:underline" onClick={() => setProgressAssignmentId(assignmentSummary.oldestOverdueAssignmentId)}>
                  Open progress details
                </button>
              ) : "No overdue assignments on this page."}
            </p>
          </div>
        </div>
      )}

      {canManage && selectedAssignmentIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-muted rounded-md border">
          <span className="text-sm font-medium">
            {selectedAssignmentIds.size} assignment{selectedAssignmentIds.size === 1 ? "" : "s"} selected
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={handleBulkComplete}
            disabled={bulkCompleting}
          >
            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
            {bulkCompleting ? "Completing..." : "Mark Complete Selected"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelectedAssignmentIds(new Set())}
          >
            Clear Selection
          </Button>
        </div>
      )}

      <div className="premium-card">
        <div className="filter-bar">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by employee or training item..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="pl-9 h-9 bg-card"
            />
          </div>
          <Select value={facilityId} onValueChange={v => { setFacilityId(v); setPage(1); }}>
            <SelectTrigger className="w-48 h-9 bg-card" aria-label="Facility">
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
            <SelectTrigger className="w-40 h-9 bg-card" aria-label="Status">
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

        {assignmentsError ? (
          <div className="p-6">
            <QueryError what="course assignments" error={assignmentsErrorDetail} onRetry={() => refetchAssignments()} />
          </div>
        ) : isLoading ? (
          <div className="p-6 space-y-3">
            {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />)}
          </div>
        ) : paginated.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <ClipboardList className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No training assignments found</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Try adjusting your search or filters</p>
          </div>
        ) : (
          <>
            {canManage && eligibleOnPage.length > 0 && (
              <div className="flex items-center gap-2 px-5 py-2 border-b border-border/60">
                <Checkbox
                  checked={allEligibleSelected ? true : someEligibleSelected ? "indeterminate" : false}
                  onCheckedChange={toggleSelectAllEligible}
                  aria-label="Select all eligible assignments on this page"
                />
                <span className="text-xs text-muted-foreground">
                  Select all eligible on page ({eligibleOnPage.length})
                </span>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="data-table min-w-[720px]">
                <thead>
                  <tr>
                    {canManage && <th className="w-10" />}
                    <th>Employee</th>
                    <th>Training item</th>
                    <th>Status</th>
                    <th>Due Date</th>
                    <th>Completed</th>
                    <th className="w-72" />
                  </tr>
                </thead>
                <tbody>
                  {paginated.map(a => {
                    const emp = employeeById.get(a.employee_id);
                    const course = courseById.get(a.course_id);
                    const assignmentVersion = courseVersionById.get(a.course_version_id);
                    const versionMetadataReady =
                      !courseVersionsLoading && !courseVersionsError && !!assignmentVersion;
                    const requiresLearnerEvidence = assignmentVersion?.content_standard === "comprehensive";
                    const cert = certificateByAssignmentId.get(a.id);
                    const eligible = isEligibleForComplete(a);
                    // Only an assignment the index still counts as open can be granted an extra
                    // attempt or cancelled: a completed one needs neither, and a cancelled one is
                    // already released.
                    const isOpen = (OPEN_ASSIGNMENT_STATUSES as readonly string[]).includes(a.status);
                    const canUnblock = isOpen && canManage;
                    return (
                      <tr key={a.id}>
                        {canManage && (
                          <td>
                            {eligible ? (
                              <Checkbox
                                checked={selectedAssignmentIds.has(a.id)}
                                onCheckedChange={() => toggleAssignment(a.id)}
                                aria-label={`Select assignment for ${emp ? `${emp.last_name}, ${emp.first_name}` : a.employee_id}`}
                              />
                            ) : null}
                          </td>
                        )}
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
                          <div className="flex flex-wrap items-center gap-1.5 justify-end">
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
                            {canManage
                              && a.status !== "completed"
                              && versionMetadataReady
                              && !requiresLearnerEvidence
                              && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 text-xs text-muted-foreground hover:text-foreground"
                                onClick={() => handleComplete(a)}
                                disabled={(completing && completingId === a.id) || bulkCompleting}
                              >
                                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                                {completing && completingId === a.id ? "Completing..." : "Mark Complete"}
                              </Button>
                              )}
                            {canUnblock && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 text-xs text-muted-foreground hover:text-foreground"
                                  onClick={() => openUnblock("grant", a)}
                                >
                                  <RotateCcw className="mr-1 h-3.5 w-3.5" />
                                  Grant another attempt
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 text-xs text-muted-foreground hover:text-destructive"
                                  onClick={() => openUnblock("cancel", a)}
                                >
                                  <Ban className="mr-1 h-3.5 w-3.5" />
                                  Cancel assignment
                                </Button>
                              </>
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

      {!assignmentsError && (
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <ClipboardList className="h-4 w-4" />
          <span>{totalCount} assignment{totalCount !== 1 ? "s" : ""} total</span>
        </div>
      )}

      <Dialog open={showAssignForm} onOpenChange={o => {
        if (!o) {
          setShowAssignForm(false);
          setAssignForm(EMPTY_ASSIGN_FORM);
          setSelectedEmployeeIds(new Set());
          setAssignEmployeeSearch("");
          setAssignFacilityFilter("all");
        }
      }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Assign Training</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${__fieldIds}-training-item`} className="text-[13px]">Training item *</Label>
              <Select value={assignForm.courseId} onValueChange={handleCourseChange}>
                <SelectTrigger id={`${__fieldIds}-training-item`} className="h-9"><SelectValue placeholder="Select training item" /></SelectTrigger>
                <SelectContent>
                  {publishedCourses.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${__fieldIds}-due-date`} className="text-[13px]">Due Date</Label>
              <Input id={`${__fieldIds}-due-date`} type="date" value={assignForm.dueDate} onChange={e => field("dueDate", e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor={`${__fieldIds}-assign-employee-search`} className="text-[13px]">Employees * ({selectedEmployeeIds.size} selected)</Label>
                <Select value={assignFacilityFilter} onValueChange={setAssignFacilityFilter}>
                  <SelectTrigger id={`${__fieldIds}-assign-facility-filter`} aria-label="Filter employees by facility" className="h-8 w-44 text-xs"><SelectValue placeholder="All Facilities" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Facilities</SelectItem>
                    {facilities?.map(f => (
                      <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  id={`${__fieldIds}-assign-employee-search`}
                  className="h-8 w-full max-w-xs text-xs"
                  placeholder="Search employees to assign"
                  value={assignEmployeeSearch}
                  onChange={(e) => setAssignEmployeeSearch(e.target.value)}
                />
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
                  {employeesLoading ? (
                    <p className="text-xs text-muted-foreground text-center py-4">
                      Loading employees…
                    </p>
                  ) : employeesError ? (
                    <QueryError what="employees" error={employeesErr} onRetry={() => void refetchEmployees()} className="m-2" />
                  ) : filteredAssignEmployees.length === 0 ? (
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
                  : "Assign Training"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!unblock}
        onOpenChange={open => { if (!open) { setUnblock(null); setUnblockReason(""); } }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {unblock?.mode === "grant" ? "Grant another attempt" : "Cancel assignment"}
            </DialogTitle>
            <DialogDescription>
              {unblock?.mode === "grant"
                ? "Adds one more attempt at this assignment's final assessment. The learner retakes it from My Training; nothing already recorded is discarded."
                : "Closes this assignment without a completion. The same course can then be assigned to this employee again — use this when a fresh start is the right answer rather than another attempt."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {unblock && (
              <p className="text-sm text-muted-foreground">
                {(() => {
                  const emp = employeeById.get(unblock.assignment.employee_id);
                  const course = courseById.get(unblock.assignment.course_id);
                  return `${emp ? `${emp.last_name}, ${emp.first_name}` : `Employee #${unblock.assignment.employee_id.slice(0, 8)}`} · ${course?.title ?? `Course #${unblock.assignment.course_id.slice(0, 8)}`}`;
                })()}
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor={`${__fieldIds}-unblock-reason`} className="text-[13px]">
                {unblock?.mode === "grant" ? "Why another attempt is warranted *" : "Cancellation reason *"}
              </Label>
              <Textarea
                id={`${__fieldIds}-unblock-reason`}
                value={unblockReason}
                onChange={e => setUnblockReason(e.target.value)}
                placeholder={unblock?.mode === "grant"
                  ? "Assessment was interrupted by a call-out; retake approved by the DON."
                  : "Employee moved to a role this course does not apply to."}
              />
              <p className="text-xs text-muted-foreground">
                Stored on the assignment record and visible in the audit trail.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setUnblock(null); setUnblockReason(""); }}>
              Keep as is
            </Button>
            <Button
              variant={unblock?.mode === "cancel" ? "destructive" : "default"}
              disabled={unblockReason.trim().length < MIN_REASON || grantingAttempt || cancelingAssignment}
              onClick={() => void submitUnblock()}
            >
              {unblock?.mode === "grant"
                ? (grantingAttempt ? "Granting…" : "Grant attempt")
                : (cancelingAssignment ? "Canceling…" : "Cancel assignment")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ProgressDialog assignmentId={progressAssignmentId} onClose={() => setProgressAssignmentId(null)} />
    </div>
  );
}
