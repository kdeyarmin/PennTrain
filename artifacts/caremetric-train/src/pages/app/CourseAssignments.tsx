import { useMemo, useState } from "react";
import {
  useListCourseAssignments,
  useCreateCourseAssignment,
  useCompleteCourseAssignment,
  useGetCourseProgress,
  type CourseAssignment,
} from "@/hooks/useCourseAssignments";
import { useListEmployees } from "@/hooks/useEmployees";
import { useListCourses, useListCourseVersions } from "@/hooks/useCourses";
import { useListFacilities } from "@/hooks/useFacilities";
import { useIssueCertificate, useListCertificates, useGenerateCertificatePdf } from "@/hooks/useCertificates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
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
  employeeId: string;
  courseId: string;
  /** "" means "use the course's current_version_id" -- see handleAssign. */
  courseVersionId: string;
  dueDate: string;
}

const EMPTY_ASSIGN_FORM: AssignFormData = {
  employeeId: "",
  courseId: "",
  courseVersionId: "",
  dueDate: "",
};

// ---------------------------------------------------------------------------
// Progress design note
//
// course_assignments can run into the thousands for a mid-size org (employees
// x courses x renewal cycles), and this list -- like Employees.tsx and
// TrainingMatrix.tsx -- fetches the full filtered set and paginates it
// client-side. Firing one useGetCourseProgress query per visible row would
// re-fan-out on every filter/page change for a query that most rows don't
// need looked at. So the main table only shows `status` and `due_date`,
// which already answers "is this done, and by when" for the common case.
// Detailed percent-complete is available on demand: clicking "Progress" opens
// a small dialog that fetches course_progress for just that one
// assignment_id, so at most one extra query is in flight at a time.
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
  const { data: assignments, isLoading } = useListCourseAssignments({
    facilityId: facilityId !== "all" ? facilityId : undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
  });
  const { data: courseVersions } = useListCourseVersions(assignForm.courseId || undefined);

  const { mutate: createAssignment, isPending: assigning } = useCreateCourseAssignment();
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
  // Only published courses have content worth assigning; course_blocks/quizzes
  // are locked once a version is published, so a draft course has nothing for
  // an employee to actually take yet.
  const publishedCourses = useMemo(() => (courses ?? []).filter(c => c.status === "published"), [courses]);

  const selectedCourse = assignForm.courseId ? courseById.get(assignForm.courseId) : undefined;
  // Assignments pin to a specific published version. Only offer the picker when
  // more than one published version exists; otherwise silently default to
  // current_version_id in handleAssign.
  const publishedVersions = useMemo(
    () => (courseVersions ?? []).filter(v => v.status === "published"),
    [courseVersions],
  );
  const showVersionPicker = publishedVersions.length > 1;

  const allAssignments = assignments ?? [];

  const filtered = allAssignments.filter(a => {
    if (!search.trim()) return true;
    const emp = employeeById.get(a.employee_id);
    const course = courseById.get(a.course_id);
    const q = search.toLowerCase();
    const empName = emp ? `${emp.first_name} ${emp.last_name}`.toLowerCase() : "";
    const courseTitle = course?.title.toLowerCase() ?? "";
    return empName.includes(q) || courseTitle.includes(q);
  });

  // Most recently assigned first -- what an admin scanning this list usually wants.
  const sorted = [...filtered].sort((a, b) => (b.assigned_at ?? "").localeCompare(a.assigned_at ?? ""));

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paginated = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const openAssign = () => {
    setAssignForm(EMPTY_ASSIGN_FORM);
    setShowAssignForm(true);
  };

  const handleCourseChange = (courseId: string) => {
    setAssignForm(f => ({ ...f, courseId, courseVersionId: "" }));
  };

  const field = (k: keyof AssignFormData, v: string) => setAssignForm(f => ({ ...f, [k]: v }));

  const handleAssign = () => {
    if (!assignForm.employeeId || !assignForm.courseId) {
      toast({ title: "Employee and course are required", variant: "destructive" });
      return;
    }
    const employee = employeeById.get(assignForm.employeeId);
    const course = courseById.get(assignForm.courseId);
    if (!employee || !course || !user?.organizationId) return;

    const versionId = assignForm.courseVersionId || course.current_version_id;
    if (!versionId) {
      toast({ title: "This course has no published version to assign", variant: "destructive" });
      return;
    }

    createAssignment(
      {
        employee_id: employee.id,
        course_id: course.id,
        course_version_id: versionId,
        facility_id: employee.facility_id,
        organization_id: user.organizationId,
        due_date: assignForm.dueDate || null,
        assigned_by: user.id,
      },
      {
        onSuccess: () => {
          toast({ title: "Course assigned" });
          setShowAssignForm(false);
          setAssignForm(EMPTY_ASSIGN_FORM);
        },
        onError: (e: Error) => toast({ title: "Failed to assign course", description: e.message, variant: "destructive" }),
      },
    );
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
                          {a.due_date ? new Date(a.due_date).toLocaleDateString() : "—"}
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
                  {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)}
                </span>{" "}
                of {sorted.length}
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
        <span>{filtered.length} assignment{filtered.length !== 1 ? "s" : ""} total</span>
      </div>

      <Dialog open={showAssignForm} onOpenChange={o => { if (!o) setShowAssignForm(false); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Assign Course</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-[13px]">Employee *</Label>
              <Select value={assignForm.employeeId} onValueChange={v => field("employeeId", v)}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {activeEmployees.map(e => (
                    <SelectItem key={e.id} value={e.id}>{e.last_name}, {e.first_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
                      Current version{selectedCourse?.current_version_id ? "" : " (none set)"} — default
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssignForm(false)}>Cancel</Button>
            <Button onClick={handleAssign} disabled={assigning} className="shadow-sm">
              {assigning ? "Assigning..." : "Assign Course"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ProgressDialog assignmentId={progressAssignmentId} onClose={() => setProgressAssignmentId(null)} />
    </div>
  );
}
