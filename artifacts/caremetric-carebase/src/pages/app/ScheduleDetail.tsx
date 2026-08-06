import { useId, lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useLocation } from "wouter";

// Lazy: the acuity engine and its weight tables are only meaningful on this page, and the schedule
// route is already heavy.
const AcuityWorkloadSection = lazy(
  () => import("@/components/schedule/AcuityWorkloadSection"),
);
import { useGetSchedule, useGenerateScheduleAssignments, useClearAutoFilledAssignments, usePublishSchedule, useUnpublishSchedule, useUpdateSchedule, useDeleteSchedule } from "@/hooks/useSchedules";
import { useGetFacility } from "@/hooks/useFacilities";
import { useListFacilityUnits } from "@/hooks/useFacilityUnits";
import { useListShiftDefinitions } from "@/hooks/useShiftDefinitions";
import { useListResidents } from "@/hooks/useResidents";
import { useListEmployeesByIds } from "@/hooks/useEmployees";
import { useMedAdminAuthorization } from "@/hooks/useMedAdminAuthorization";
import {
  useListShiftAssignments, useCreateShiftAssignment, useUpdateShiftAssignment, useDeleteShiftAssignment,
  type ShiftAssignmentWithDetails,
} from "@/hooks/useShiftAssignments";
import {
  useCreateScheduleEligibilityOverride,
  usePreviewShiftAssignmentCandidates,
  useScheduleServiceWorkload,
  type EligibilityCandidate,
} from "@/hooks/useSchedulingEligibility";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AlertTriangle, ArrowLeft, BarChart3, CheckCircle2, Eraser, Loader2, Pill, Plus, Send, Sparkles, Undo2, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { enumerateDatesIso, formatDateLabel, formatTimeLabel } from "@/lib/scheduleDates";
import { toFacilityDateTimeLocal, facilityDateTimeLocalToUtcIso} from "@/lib/dateUtils";
import { summarizeScheduleAnalytics, summarizeStaffingRatios, summarizeMedAdminCoverage } from "@/lib/scheduleAnalytics";
import { QueryError } from "@/components/QueryState";

const UNASSIGNED = "__unassigned__";

const SHIFT_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "scheduled", label: "Scheduled" },
  { value: "confirmed", label: "Confirmed" },
  { value: "completed", label: "Completed" },
  { value: "called_off", label: "Called Off" },
  { value: "no_show", label: "No Show" },
];

const ELIGIBILITY_LABELS: Record<string, string> = {
  lifecycle_inactive: "Inactive employment",
  facility_not_assigned: "Not assigned to this facility",
  confirmed_exclusion: "Confirmed exclusion",
  schedule_conflict: "Overlapping shift",
  insufficient_rest: "Insufficient rest between shifts",
  weekly_hours_limit: "Weekly-hour limit exceeded",
  weekly_hours_warning: "Approaching weekly-hour limit",
  employee_unavailable: "Employee marked unavailable",
};

function explainEligibilityCode(code: string) {
  if (ELIGIBILITY_LABELS[code]) return ELIGIBILITY_LABELS[code];
  if (code.startsWith("qualification:")) return `Missing or expired qualification: ${code.slice(14).replaceAll("-", " ")}`;
  if (code.startsWith("credential:")) return `Missing or expired credential: ${code.slice(11).replaceAll("_", " ")}`;
  if (code.startsWith("training:")) return `Required training is missing or expired (${code.slice(9)})`;
  return code.replaceAll("_", " ");
}

function eligibilityBadge(candidate: EligibilityCandidate) {
  if (candidate.outcome === "blocked") return { label: "Blocked", className: "border-red-300 bg-red-50 text-red-800" };
  if (candidate.outcome === "warning") return { label: "Eligible with warning", className: "border-amber-300 bg-amber-50 text-amber-800" };
  return { label: "Eligible", className: "border-emerald-300 bg-emerald-50 text-emerald-800" };
}

const NON_OVERRIDABLE_BLOCKS = new Set(["lifecycle_inactive", "confirmed_exclusion", "facility_not_assigned", "schedule_conflict"]);

// Per-employee "can this person currently pass meds" signal for the shift grid -- only rendered for
// employees flagged as administering medications (see callers below); everyone else has nothing to
// show here since the badge would otherwise misleadingly read as "not authorized" for staff who were
// never in scope for med-admin certification at all (e.g. a cook or housekeeper on the same shift).
// Same green/red "Authorized Today" vocabulary as MedAdminRoster.tsx for a consistent signal across
// both pages.
//
// isLoading/isError mirror the same medAuthLoading/medAuthIsError the coverage banner above already
// gates on: useMedAdminAuthorization computes authorizedToday: false the instant training records or
// practicums are still loading (or their query failed), because the pure computation just treats
// not-yet-arrived data as an empty array -- so without this, a qualified employee flashes the red
// "not currently authorized" badge on every slow load, and stays on it if the query then fails.
function MedAdminAuthorizationIndicator({ authorized, isLoading, isError }: { authorized: boolean; isLoading: boolean; isError: boolean }) {
  if (isLoading) {
    return (
      <span className="inline-flex shrink-0 text-muted-foreground" title="Checking medication-administration authorization...">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        <span className="sr-only">Checking medication-administration authorization...</span>
      </span>
    );
  }
  if (isError) {
    return (
      <span className="inline-flex shrink-0 text-muted-foreground" title="Medication-administration authorization status unavailable">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="sr-only">Medication-administration authorization status unavailable</span>
      </span>
    );
  }
  const label = authorized ? "Authorized to pass medications today" : "Not currently authorized to pass medications";
  const Icon = authorized ? CheckCircle2 : XCircle;
  return (
    <span className={`inline-flex shrink-0 ${authorized ? "text-success" : "text-destructive"}`} title={label}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export default function ScheduleDetail() {
  const __fieldIds = useId();
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: schedule, isLoading: scheduleLoading, isError: scheduleError, error: scheduleErr, refetch: refetchSchedule } = useGetSchedule(id);
  const facilityId = schedule?.facility_id;
  const { data: facility } = useGetFacility(facilityId);
  const { data: units } = useListFacilityUnits({ facilityId });
  const { data: shiftDefs } = useListShiftDefinitions({ facilityId });
  const { data: activeResidents } = useListResidents({ facilityId: facilityId ?? "00000000-0000-0000-0000-000000000000", status: "active" });
  const { data: assignments, isLoading: assignmentsLoading } = useListShiftAssignments({ scheduleId: id });
  const {
    data: serviceWorkload,
    isLoading: serviceWorkloadLoading,
    isError: serviceWorkloadError,
    error: serviceWorkloadErrorDetail,
    refetch: refetchServiceWorkload,
  } = useScheduleServiceWorkload(id);

  // Med-admin "who can pass meds today" signal, joined onto whoever is actually scheduled this
  // period -- reuses the same hook MedAdminRoster.tsx is built on (see useMedAdminAuthorization.ts)
  // instead of a second copy of the cert+practicum join logic.
  const scheduledEmployeeIds = useMemo(
    () => [...new Set((assignments ?? []).map((a) => a.employee_id))].sort(),
    [assignments],
  );
  const { data: scheduledEmployees, ...scheduledEmployeesQuery } = useListEmployeesByIds(scheduledEmployeeIds);
  const {
    byEmployeeId: medAuthByEmployeeId,
    isLoading: medAuthLoading,
    isError: medAuthIsError,
    error: medAuthError,
    refetch: refetchMedAuth,
  } = useMedAdminAuthorization(scheduledEmployees ?? []);

  const generate = useGenerateScheduleAssignments();
  const clearAutoFill = useClearAutoFilledAssignments();
  const publish = usePublishSchedule();
  const unpublish = useUnpublishSchedule();
  // A schedule could be created, auto-filled, published and unpublished, and never corrected or
  // removed (BACKLOG.md G16.13, G16.14). Both are draft-only here: the period bounds the assignment
  // grid, and moving them under a published schedule would silently orphan shifts employees have
  // already been shown. Publishing is the point at which a schedule stops being editable.
  const updateSchedule = useUpdateSchedule();
  const deleteSchedule = useDeleteSchedule();
  const createAssignment = useCreateShiftAssignment();
  const updateAssignment = useUpdateShiftAssignment();
  const deleteAssignment = useDeleteShiftAssignment();

  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [addTarget, setAddTarget] = useState<{ unitId: string | null; date: string } | null>(null);
  const [editTarget, setEditTarget] = useState<ShiftAssignmentWithDetails | null>(null);

  const [addForm, setAddForm] = useState({ shiftDefinitionId: "", notes: "" });
  const [addEmployeeIds, setAddEmployeeIds] = useState<Set<string>>(new Set());
  const [isAddingShifts, setIsAddingShifts] = useState(false);
  const eligibilityPreview = usePreviewShiftAssignmentCandidates({
    scheduleId: addTarget ? id : undefined,
    shiftDate: addTarget?.date,
    shiftDefinitionId: addForm.shiftDefinitionId || undefined,
    unitId: addTarget?.unitId,
  });
  const createOverride = useCreateScheduleEligibilityOverride();
  const [overrideTarget, setOverrideTarget] = useState<{ candidate: EligibilityCandidate; blockCode: string } | null>(null);
  const [overrideForm, setOverrideForm] = useState({ reason: "", authorityReference: "", expiresAt: "" });
  const [editForm, setEditForm] = useState({ unitId: UNASSIGNED, shiftDefinitionId: "", status: "scheduled", notes: "" });
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({ title: "", period_start: "", period_end: "" });
  const [confirmDeleteSchedule, setConfirmDeleteSchedule] = useState(false);
  // Tracks which single cell's status dropdown is mid-update (rather than reusing
  // updateAssignment.isPending, which reflects the shared mutation instance and would also flip
  // true while the edit-shift modal's own Save is in flight) so only that one badge shows "…".
  const [quickStatusId, setQuickStatusId] = useState<string | null>(null);
  const [residentsInHouse, setResidentsInHouse] = useState(0);
  const [targetPpd, setTargetPpd] = useState(2.0);
  const [minimumStaffPerDay, setMinimumStaffPerDay] = useState(2);
  const [censusWasEdited, setCensusWasEdited] = useState(false);

  const dates = useMemo(
    () => (schedule ? enumerateDatesIso(schedule.period_start, schedule.period_end) : []),
    [schedule]
  );

  const activeUnits = useMemo(() => (units ?? []).filter((u) => u.is_active), [units]);
  const activeShiftDefs = useMemo(() => (shiftDefs ?? []).filter((s) => s.is_active), [shiftDefs]);
  const eligibleCandidates = useMemo(
    () => (eligibilityPreview.data ?? []).filter((candidate) => candidate.outcome !== "blocked"),
    [eligibilityPreview.data]
  );
  const activeResidentCount = activeResidents?.length ?? 0;

  useEffect(() => {
    if (!censusWasEdited) setResidentsInHouse(activeResidentCount);
  }, [activeResidentCount, censusWasEdited]);

  useEffect(() => {
    if (!eligibilityPreview.data) return;
    const allowed = new Set(eligibleCandidates.map((candidate) => candidate.employeeId));
    setAddEmployeeIds((selected) => new Set([...selected].filter((employeeId) => allowed.has(employeeId))));
  }, [eligibilityPreview.data, eligibleCandidates]);

  const grid = useMemo(() => {
    const map = new Map<string, ShiftAssignmentWithDetails[]>();
    for (const a of assignments ?? []) {
      const key = `${a.unit_id ?? UNASSIGNED}|${a.shift_date}`;
      const list = map.get(key) ?? [];
      list.push(a);
      map.set(key, list);
    }
    return map;
  }, [assignments]);

  const scheduleAnalytics = useMemo(() => summarizeScheduleAnalytics({
    assignments: assignments ?? [],
    dates,
    unitIds: activeUnits.map((u) => u.id),
  }), [assignments, dates, activeUnits]);

  const staffingRatios = useMemo(() => summarizeStaffingRatios({
    assignments: assignments ?? [],
    dates,
    residentsInHouse,
    targetPpd,
    minimumStaffPerDay,
  }), [assignments, dates, residentsInHouse, targetPpd, minimumStaffPerDay]);

  const medAdminCoverage = useMemo(() => summarizeMedAdminCoverage({
    assignments: (assignments ?? []).map((a) => ({
      employee_id: a.employee_id,
      shift_date: a.shift_date,
      status: a.status,
      shift_definition_id: a.shift_definition_id,
      shift_name: a.shift_definitions?.name ?? formatTimeLabel(a.start_time),
    })),
    dates,
    isAuthorized: (employeeId) => medAuthByEmployeeId.get(employeeId)?.authorizedToday ?? false,
  }), [assignments, dates, medAuthByEmployeeId]);
  // Suppress the coverage-gap banner while any of its inputs are still loading, and never let a
  // failed fetch masquerade as "fully covered" -- an unauthorized-looking employee because their
  // training record request errored is not the same as one who actually lapsed.
  const medAdminCoverageLoading = assignmentsLoading || scheduledEmployeesQuery.isLoading || medAuthLoading;
  const medAdminCoverageFailure = scheduledEmployeesQuery.isError
    ? scheduledEmployeesQuery.error
    : medAuthIsError ? medAuthError : null;

  const isDraft = schedule?.status === "draft";
  const hasAutoFill = (assignments ?? []).some((a) => a.source === "auto_fill" && a.status === "scheduled");

  function openAddDialog(unitId: string | null, date: string) {
    setAddForm({ shiftDefinitionId: activeShiftDefs[0]?.id ?? "", notes: "" });
    setAddEmployeeIds(new Set());
    setAddTarget({ unitId, date });
  }

  function toggleAddEmployee(employeeId: string) {
    setAddEmployeeIds((prev) => {
      const next = new Set(prev);
      if (next.has(employeeId)) next.delete(employeeId); else next.add(employeeId);
      return next;
    });
  }

  const allAddEmployeesSelected = eligibleCandidates.length > 0 && eligibleCandidates.every((candidate) => addEmployeeIds.has(candidate.employeeId));
  const someAddEmployeesSelected = eligibleCandidates.some((candidate) => addEmployeeIds.has(candidate.employeeId));

  function toggleSelectAllAddEmployees() {
    setAddEmployeeIds(allAddEmployeesSelected ? new Set() : new Set(eligibleCandidates.map((candidate) => candidate.employeeId)));
  }

function openOverride(candidate: EligibilityCandidate, blockCode: string) {
  const shiftDef = activeShiftDefs.find((s) => s.id === addForm.shiftDefinitionId);
  const defaultExpiresAt = (() => {
    if (!addTarget || !shiftDef) return new Date(Date.now() + 24 * 60 * 60 * 1000);
    const start = new Date(`${addTarget.date}T${shiftDef.start_time}`);
    const end = new Date(`${addTarget.date}T${shiftDef.end_time}`);
    if (end <= start) end.setDate(end.getDate() + 1);
    return end;
  })();

  setOverrideForm({
    reason: "",
    authorityReference: "",
    expiresAt: toFacilityDateTimeLocal(defaultExpiresAt),
  });
  setOverrideTarget({ candidate, blockCode });
}

  function handleCreateOverride() {
    if (!overrideTarget || !schedule || !addForm.shiftDefinitionId) return;
    createOverride.mutate({
      employeeId: overrideTarget.candidate.employeeId,
      facilityId: schedule.facility_id,
      blockCode: overrideTarget.blockCode,
      scopeType: "shift",
      scopeId: addForm.shiftDefinitionId,
      reason: overrideForm.reason,
      authorityReference: overrideForm.authorityReference,
      expiresAt: facilityDateTimeLocalToUtcIso(overrideForm.expiresAt),
    }, {
      onSuccess: () => {
        toast({ title: "Bounded override approved", description: "The reason, authority, scope, expiration, and approver were audit logged.", variant: "success" });
        setOverrideTarget(null);
      },
      onError: (error: Error) => toast({ title: "Override not approved", description: error.message, variant: "destructive" }),
    });
  }

  function openEditDialog(a: ShiftAssignmentWithDetails) {
    setEditForm({
      unitId: a.unit_id ?? UNASSIGNED,
      shiftDefinitionId: a.shift_definition_id ?? "",
      status: a.status,
      notes: a.notes ?? "",
    });
    setEditTarget(a);
  }

  // Applies the same shift to every selected employee in one batch via Promise.allSettled (so one
  // employee's conflict doesn't block the rest), then reports a single summary toast -- mirrors
  // the bulk-assignment pattern used elsewhere in this app (e.g. CourseAssignments' Assign Training).
  async function handleAdd() {
    if (!addTarget || !schedule || addEmployeeIds.size === 0 || !addForm.shiftDefinitionId) {
      toast({ title: "Pick at least one employee and a shift", variant: "destructive" });
      return;
    }
    const shiftDef = activeShiftDefs.find((s) => s.id === addForm.shiftDefinitionId);
    if (!shiftDef) return;
    const allowed = new Set(eligibleCandidates.map((candidate) => candidate.employeeId));
    const employeeIds = [...addEmployeeIds].filter((employeeId) => allowed.has(employeeId));
    if (employeeIds.length === 0) {
      toast({ title: "No eligible employees selected", variant: "destructive" });
      return;
    }

    const describeFailure = (reason: unknown) => {
      const message = reason instanceof Error ? reason.message : String(reason);
      return message.includes("duplicate") || message.includes("overlapping shift")
        ? "This employee already has a conflicting shift for that day."
        : message;
    };

    setIsAddingShifts(true);
    const results = await Promise.allSettled(
      employeeIds.map((employeeId) =>
        createAssignment.mutateAsync({
          organization_id: schedule.organization_id,
          schedule_id: schedule.id,
          facility_id: schedule.facility_id,
          employee_id: employeeId,
          unit_id: addTarget.unitId,
          shift_definition_id: shiftDef.id,
          shift_date: addTarget.date,
          start_time: shiftDef.start_time,
          end_time: shiftDef.end_time,
          status: "scheduled",
          source: "manual",
          notes: addForm.notes.trim() || null,
        })
      )
    );
    setIsAddingShifts(false);

    if (employeeIds.length === 1) {
      const [only] = results;
      if (only.status === "fulfilled") {
        toast({ title: "Shift added", variant: "success" });
        setAddTarget(null);
      } else {
        toast({ title: "Couldn't add shift", description: describeFailure(only.reason), variant: "destructive" });
      }
      return;
    }

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - succeeded;
    toast({
      title: failed === 0 ? "Shifts added" : succeeded === 0 ? "Couldn't add shifts" : "Shifts partially added",
      description:
        `${succeeded} of ${employeeIds.length} employees added successfully.`
        + (failed > 0 ? ` ${failed} failed -- check for conflicting shifts.` : ""),
      variant: failed === 0 ? "success" : succeeded === 0 ? "destructive" : undefined,
    });
    if (succeeded > 0) setAddTarget(null);
  }

  // Cycles a single shift's status without opening the full edit modal -- the common case is a
  // status-only change (called off, confirmed, etc.), and this uses the same update mutation the
  // modal's Save button calls, just with a smaller payload. Notes/unit/time changes still require
  // the full modal.
  function handleQuickStatusChange(assignment: ShiftAssignmentWithDetails, status: string) {
    if (status === assignment.status || quickStatusId) return;
    setQuickStatusId(assignment.id);
    updateAssignment.mutate(
      { id: assignment.id, status },
      {
        onSuccess: () => {
          const label = SHIFT_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
          toast({ title: `Marked as ${label}`, variant: "success" });
        },
        onError: (e: Error) => toast({ title: "Couldn't update status", description: e.message, variant: "destructive" }),
        onSettled: () => setQuickStatusId(null),
      }
    );
  }

  function handleEditSave() {
    if (!editTarget) return;
    // Keep start_time/end_time in sync with whichever shift type is now selected -- these are
    // denormalized onto the assignment, so leaving them stale would show the new shift's name
    // next to the old shift's hours in both the manager grid and the employee's own view.
    const selectedShiftDef = activeShiftDefs.find((s) => s.id === editForm.shiftDefinitionId);
    updateAssignment.mutate(
      {
        id: editTarget.id,
        unit_id: editForm.unitId === UNASSIGNED ? null : editForm.unitId,
        shift_definition_id: editForm.shiftDefinitionId || null,
        start_time: selectedShiftDef?.start_time ?? editTarget.start_time,
        end_time: selectedShiftDef?.end_time ?? editTarget.end_time,
        status: editForm.status,
        notes: editForm.notes.trim() || null,
      },
      {
        onSuccess: () => {
          toast({ title: "Shift updated" });
          setEditTarget(null);
        },
        onError: (e: Error) =>
          toast({
            title: "Couldn't update shift",
            description:
              e.message.includes("duplicate") || e.message.includes("overlapping shift")
                ? "This employee already has a conflicting shift for that day."
                : e.message,
            variant: "destructive",
          }),
      }
    );
  }

  function handleDelete() {
    if (!editTarget) return;
    deleteAssignment.mutate(editTarget.id, {
      onSuccess: () => {
        toast({ title: "Shift removed" });
        setEditTarget(null);
      },
      onError: (e: Error) => toast({ title: "Couldn't remove shift", description: e.message, variant: "destructive" }),
    });
  }

  function handleGenerate() {
    if (!schedule) return;
    generate.mutate(schedule.id, {
      onSuccess: (result) => {
        toast({ title: "Auto-fill complete", description: `${result.inserted} shift(s) added, ${result.skipped} skipped (already scheduled or would create an overlapping shift).` });
      },
      onError: (e: Error) => toast({ title: "Auto-fill failed", description: e.message, variant: "destructive" }),
    });
  }

  function handleClearAutoFill() {
    if (!schedule) return;
    clearAutoFill.mutate(schedule.id, {
      onSuccess: (count) => {
        toast({ title: `Cleared ${count} auto-filled shift(s)` });
        setShowClearConfirm(false);
      },
      onError: (e: Error) => toast({ title: "Could not clear auto-fill", description: e.message, variant: "destructive" }),
    });
  }

  function handlePublishToggle() {
    if (!schedule) return;
    if (schedule.status === "draft") {
      publish.mutate(schedule.id, {
        onSuccess: () => toast({ title: "Schedule published -- employees can now see it" }),
        onError: (e: Error) => toast({ title: "Could not publish schedule", description: e.message, variant: "destructive" }),
      });
    } else {
      unpublish.mutate(schedule.id, {
        onSuccess: () => toast({ title: "Schedule moved back to draft" }),
        onError: (e: Error) => toast({ title: "Could not unpublish schedule", description: e.message, variant: "destructive" }),
      });
    }
  }

  if (scheduleLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (scheduleError) {
    return <QueryError what="this schedule" error={scheduleErr} onRetry={() => void refetchSchedule()} />;
  }

  if (!schedule) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        Schedule not found.
      </div>
    );
  }

  const rows: { key: string; unitId: string | null; name: string }[] = [
    ...activeUnits.map((u) => ({ key: u.id, unitId: u.id, name: u.name })),
    { key: UNASSIGNED, unitId: null, name: "Unassigned" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Button variant="ghost" size="sm" className="mb-1 -ml-2" onClick={() => navigate("/app/schedule")}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            All Schedules
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">
            {schedule.title || `${facility?.name ?? "Schedule"}`}
          </h1>
          <p className="text-muted-foreground">
            {facility?.name} &middot; {formatDateLabel(schedule.period_start)} &ndash; {formatDateLabel(schedule.period_end)}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={schedule.status === "published" ? "default" : "secondary"} className="mr-1">
            {schedule.status}
          </Badge>
          {isDraft && (
            <>
              <Button variant="outline" onClick={handleGenerate} disabled={generate.isPending}>
                <Sparkles className="h-4 w-4 mr-2" />
                {generate.isPending ? "Filling..." : "Auto-Fill from Typical Patterns"}
              </Button>
              {hasAutoFill && (
                <Button variant="outline" onClick={() => setShowClearConfirm(true)}>
                  <Eraser className="h-4 w-4 mr-2" />
                  Clear Auto-Fill
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => {
                  setScheduleForm({
                    title: schedule.title ?? "",
                    period_start: schedule.period_start,
                    period_end: schedule.period_end,
                  });
                  setEditingSchedule(true);
                }}
              >
                Edit details
              </Button>
              <Button variant="outline" onClick={() => setConfirmDeleteSchedule(true)}>
                Delete
              </Button>
            </>
          )}
          <Button onClick={handlePublishToggle} disabled={publish.isPending || unpublish.isPending}>
            {isDraft ? <Send className="h-4 w-4 mr-2" /> : <Undo2 className="h-4 w-4 mr-2" />}
            {isDraft ? "Publish" : "Move to Draft"}
          </Button>
        </div>
      </div>

      {editingSchedule && (
        <Card>
          <CardContent className="space-y-3 pt-4">
            <p className="text-sm text-muted-foreground">
              Only while the schedule is a draft. The period bounds the assignment grid, so changing
              it once employees have been shown their shifts would orphan them.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="schedule-title">Title</Label>
                <Input id="schedule-title" value={scheduleForm.title} onChange={(e) => setScheduleForm((f) => ({ ...f, title: e.target.value }))} placeholder="Week of 12 August" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="schedule-start">Period start</Label>
                <Input id="schedule-start" type="date" value={scheduleForm.period_start} onChange={(e) => setScheduleForm((f) => ({ ...f, period_start: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="schedule-end">Period end</Label>
                <Input id="schedule-end" type="date" value={scheduleForm.period_end} onChange={(e) => setScheduleForm((f) => ({ ...f, period_end: e.target.value }))} />
              </div>
            </div>
            {scheduleForm.period_start && scheduleForm.period_end && scheduleForm.period_end < scheduleForm.period_start && (
              <p className="text-sm text-destructive">The period cannot end before it starts.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={
                  updateSchedule.isPending
                  || !scheduleForm.period_start
                  || !scheduleForm.period_end
                  || scheduleForm.period_end < scheduleForm.period_start
                }
                onClick={() => updateSchedule.mutate({
                  id: schedule.id,
                  title: scheduleForm.title.trim() || null,
                  period_start: scheduleForm.period_start,
                  period_end: scheduleForm.period_end,
                }, {
                  onSuccess: () => { setEditingSchedule(false); toast({ title: "Schedule updated" }); },
                  onError: (error) => toast({ title: "Could not update the schedule", description: error instanceof Error ? error.message : String(error), variant: "destructive" }),
                })}
              >
                {updateSchedule.isPending ? "Saving..." : "Save"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingSchedule(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!isDraft && (
        <p className="text-sm text-muted-foreground">
          This schedule is published -- employees assigned to it can see their shifts under My Schedule.
          Move it back to draft to auto-fill or bulk-edit.
        </p>
      )}

      {medAdminCoverageFailure ? (
        <QueryError
          what="medication-administration authorization for this schedule"
          error={medAdminCoverageFailure}
          onRetry={() => {
            void scheduledEmployeesQuery.refetch();
            refetchMedAuth();
          }}
        />
      ) : !medAdminCoverageLoading && medAdminCoverage.gaps.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <div className="flex items-start gap-2">
            <Pill className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1.5">
              <p className="font-medium">
                {medAdminCoverage.datesWithGaps.length} day{medAdminCoverage.datesWithGaps.length === 1 ? "" : "s"} in
                this period {medAdminCoverage.datesWithGaps.length === 1 ? "has" : "have"} a shift with no staff
                currently authorized to pass medications.
              </p>
              <ul className="list-disc pl-5 text-xs space-y-0.5">
                {medAdminCoverage.gaps.map((gap) => (
                  <li key={`${gap.date}-${gap.shiftName}`}>
                    {formatDateLabel(gap.date)} &middot; {gap.shiftName}: {gap.scheduledStaff} staff scheduled, none
                    currently authorized to pass medications.
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">Coverage & Hours Snapshot</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Shifts</p>
              <p className="text-xl font-semibold">{scheduleAnalytics.totalShifts}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Scheduled hours</p>
              <p className="text-xl font-semibold">{scheduleAnalytics.scheduledHours}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Auto / manual</p>
              <p className="text-xl font-semibold">{scheduleAnalytics.autoFilledShifts} / {scheduleAnalytics.manualShifts}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Exceptions</p>
              <p className="text-xl font-semibold">{scheduleAnalytics.exceptionShifts}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Unit-day gaps</p>
              <p className="text-xl font-semibold">{scheduleAnalytics.unitDayCoverageGaps}</p>
            </div>
          </div>
          <div className="rounded-lg border bg-muted/20 p-4 space-y-4">
            <div>
              <h3 className="font-medium">Resident census & staffing calculator</h3>
              <p className="text-xs text-muted-foreground">Active resident census loads automatically; override it for today's in-house count to calculate PPD and staffing gaps before publishing.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="residentsInHouse">Residents in house</Label>
                <Input id="residentsInHouse" type="number" min={0} value={residentsInHouse} onChange={(e) => { setCensusWasEdited(true); setResidentsInHouse(Number(e.target.value) || 0); }} />
                <button type="button" className="text-xs text-primary hover:underline" onClick={() => { setCensusWasEdited(false); setResidentsInHouse(activeResidentCount); }}>Use active census ({activeResidentCount})</button>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="targetPpd">Target PPD</Label>
                <Input id="targetPpd" type="number" min={0} step="0.1" value={targetPpd} onChange={(e) => setTargetPpd(Number(e.target.value) || 0)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="minimumStaffPerDay">Minimum staff/day</Label>
                <Input id="minimumStaffPerDay" type="number" min={0} value={minimumStaffPerDay} onChange={(e) => setMinimumStaffPerDay(Number(e.target.value) || 0)} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border bg-background p-3">
                <p className="text-xs text-muted-foreground">Current PPD</p>
                <p className="text-xl font-semibold">{staffingRatios.ppd.toFixed(2)}</p>
              </div>
              <div className="rounded-lg border bg-background p-3">
                <p className="text-xs text-muted-foreground">Care hours needed</p>
                <p className="text-xl font-semibold">{staffingRatios.targetHours}</p>
              </div>
              <div className="rounded-lg border bg-background p-3">
                <p className="text-xs text-muted-foreground">Hours gap</p>
                <p className="text-xl font-semibold">{staffingRatios.hoursGap}</p>
                <p className="text-[11px] text-muted-foreground">{staffingRatios.hoursGapPerDay}/day</p>
              </div>
              <div className="rounded-lg border bg-background p-3">
                <p className="text-xs text-muted-foreground">8h shifts to add</p>
                <p className="text-xl font-semibold">{staffingRatios.suggestedEightHourShifts}</p>
                <p className="text-[11px] text-muted-foreground">Residents/staff avg. {staffingRatios.averageResidentsPerScheduledStaff ?? "—"}</p>
              </div>
            </div>
          </div>
          {id && (
            <Suspense fallback={null}>
              <AcuityWorkloadSection scheduleId={id} />
            </Suspense>
          )}
          <div className="rounded-lg border bg-muted/20 p-4 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-medium">Service workload</h3>
                <p className="text-xs text-muted-foreground">
                  Operational demand from active residents, support-plan services, two-person work, escorts, safety checks, secured-unit coverage, and known appointment or transportation tasks. This is not a medical-acuity score.
                </p>
              </div>
              <Badge variant={serviceWorkloadError || serviceWorkloadLoading ? "secondary" : (serviceWorkload?.coverageGapCount ?? 0) > 0 ? "destructive" : "secondary"}>
                {serviceWorkloadError || serviceWorkloadLoading ? "—" : `${serviceWorkload?.coverageGapCount ?? 0} coverage gaps`}
              </Badge>
            </div>
            {serviceWorkloadError ? (
              <QueryError what="service workload" error={serviceWorkloadErrorDetail} onRetry={() => void refetchServiceWorkload()} />
            ) : (
            <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Active residents", serviceWorkloadLoading ? "—" : (serviceWorkload?.activeResidents ?? activeResidentCount)],
                ["Support-plan services", serviceWorkloadLoading ? "—" : (serviceWorkload?.supportPlanServices ?? 0)],
                ["Two-person services", serviceWorkloadLoading ? "—" : (serviceWorkload?.twoPersonTransfers ?? 0)],
                ["Escorts", serviceWorkloadLoading ? "—" : (serviceWorkload?.escorts ?? 0)],
                ["Safety checks", serviceWorkloadLoading ? "—" : (serviceWorkload?.safetyChecks ?? 0)],
                ["Appointments / transport", serviceWorkloadLoading ? "—" : (serviceWorkload?.appointmentTransportationDemand ?? 0)],
                ["Secured-unit residents", serviceWorkloadLoading ? "—" : (serviceWorkload?.securedUnitResidents ?? 0)],
                ["Configured unit-shifts", serviceWorkloadLoading ? "—" : (serviceWorkload?.coverageRows.length ?? 0)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border bg-background p-3">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-xl font-semibold">{value}</p>
                </div>
              ))}
            </div>
            {serviceWorkloadLoading ? (
              <p className="text-xs text-muted-foreground">Loading service workload…</p>
            ) : (serviceWorkload?.coverageRows.length ?? 0) === 0 ? (
              <p className="text-xs text-muted-foreground">
                Configure qualification and service-workload requirements in Scheduling Setup to compare scheduled qualified coverage against each unit and shift.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border bg-background">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="p-2 text-left">Date / unit / shift</th>
                      <th className="p-2 text-left">Staff</th>
                      <th className="p-2 text-left">Medication</th>
                      <th className="p-2 text-left">Insulin</th>
                      <th className="p-2 text-left">First aid / CPR</th>
                      <th className="p-2 text-left">Trainer / supervisor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {serviceWorkload?.coverageRows.map((row) => {
                      const gap = row.scheduled_staff < row.minimum_staff
                        || row.medication_qualified_staff < row.minimum_medication_qualified_staff
                        || row.insulin_qualified_staff < row.minimum_insulin_qualified_staff
                        || row.first_aid_cpr_staff < row.minimum_first_aid_cpr_staff
                        || row.trainer_supervisor_staff < row.minimum_trainer_supervisor_staff;
                      return (
                        <tr key={`${row.workload_profile_id}-${row.shift_date}`} className={gap ? "border-t bg-red-50/70" : "border-t"}>
                          <td className="p-2 font-medium">{formatDateLabel(row.shift_date)} &middot; {row.unit_name} &middot; {row.shift_name}</td>
                          <td className="p-2">{row.scheduled_staff}/{row.minimum_staff}</td>
                          <td className="p-2">{row.medication_qualified_staff}/{row.minimum_medication_qualified_staff}</td>
                          <td className="p-2">{row.insulin_qualified_staff}/{row.minimum_insulin_qualified_staff}</td>
                          <td className="p-2">{row.first_aid_cpr_staff}/{row.minimum_first_aid_cpr_staff}</td>
                          <td className="p-2">{row.trainer_supervisor_staff}/{row.minimum_trainer_supervisor_staff}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            </>
            )}
          </div>
          {(scheduleAnalytics.unitDayCoverageGaps > 0 || scheduleAnalytics.employeesOver40Hours.length > 0 || staffingRatios.isBelowTarget || staffingRatios.daysBelowMinimumStaffing.length > 0) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-1">
                  <p className="font-medium">Review coverage before publishing.</p>
                  <ul className="list-disc pl-5 text-xs">
                    {scheduleAnalytics.unitDayCoverageGaps > 0 && <li>{scheduleAnalytics.unitDayCoverageGaps} unit-day coverage gap{scheduleAnalytics.unitDayCoverageGaps === 1 ? "" : "s"} based on active units and schedule dates.</li>}
                    {staffingRatios.isBelowTarget && <li>Current PPD is {staffingRatios.ppd.toFixed(2)} against a target of {staffingRatios.targetPpd.toFixed(2)}; add {staffingRatios.hoursGap} scheduled care hour{staffingRatios.hoursGap === 1 ? "" : "s"} ({staffingRatios.suggestedEightHourShifts} more 8-hour shift{staffingRatios.suggestedEightHourShifts === 1 ? "" : "s"}) to meet the target.</li>}
                    {staffingRatios.daysBelowMinimumStaffing.map((row) => (
                      <li key={row.date}>{formatDateLabel(row.date)} has {row.scheduledStaff} scheduled staff, below the minimum of {row.minimumStaff}.</li>
                    ))}
                    {scheduleAnalytics.employeesOver40Hours.map((row) => (
                      <li key={row.employeeId}>{row.name} is scheduled for {row.hours} hours in this period.</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/50">
                <th className="text-left p-3 sticky left-0 bg-muted/50 min-w-36 border-b">Unit</th>
                {dates.map((d) => (
                  <th key={d} className="text-left p-3 min-w-40 border-b border-l">{formatDateLabel(d)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {assignmentsLoading ? (
                <tr><td colSpan={dates.length + 1} className="p-6 text-center text-muted-foreground">Loading shifts...</td></tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.key} className="border-b align-top">
                    <td className="p-3 font-medium sticky left-0 bg-background border-r">{row.name}</td>
                    {dates.map((d) => {
                      const cellAssignments = grid.get(`${row.key}|${d}`) ?? [];
                      return (
                        <td key={d} className="p-2 border-l align-top">
                          <div className="space-y-1">
                            {cellAssignments.map((a) => {
                              const auth = medAuthByEmployeeId.get(a.employee_id);
                              return (
                                <div
                                  key={a.id}
                                  className="w-full rounded-md border px-2 py-1 hover:shadow-sm transition-shadow"
                                  style={a.shift_definitions?.color ? { borderLeftColor: a.shift_definitions.color, borderLeftWidth: 3 } : undefined}
                                >
                                  <button type="button" onClick={() => openEditDialog(a)} className="w-full text-left block">
                                    <div className="font-medium truncate flex items-center gap-1">
                                      <span className="truncate min-w-0">{a.employees?.first_name} {a.employees?.last_name}</span>
                                      {auth?.administersMedications && (
                                        <MedAdminAuthorizationIndicator
                                          authorized={auth.authorizedToday}
                                          isLoading={medAuthLoading}
                                          isError={medAuthIsError}
                                        />
                                      )}
                                    </div>
                                  </button>
                                  <div className="text-xs text-muted-foreground flex items-center justify-between gap-1">
                                    <button
                                      type="button"
                                      onClick={() => openEditDialog(a)}
                                      className="truncate text-left flex-1 min-w-0"
                                      title="Edit shift"
                                    >
                                      {a.shift_definitions?.name ?? formatTimeLabel(a.start_time)}
                                    </button>
                                    {/* Quick status change -- the common case doesn't need the full edit modal.
                                        Anything beyond status (notes, unit, time) still goes through openEditDialog above. */}
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <button
                                          type="button"
                                          disabled={quickStatusId === a.id}
                                          className="shrink-0 rounded-sm disabled:opacity-60 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                          aria-label={`Change status for ${a.employees?.first_name} ${a.employees?.last_name}`}
                                        >
                                          <Badge
                                            variant={a.status === "called_off" || a.status === "no_show" ? "destructive" : "secondary"}
                                            className="text-[10px] px-1 py-0 cursor-pointer hover:opacity-80"
                                          >
                                            {quickStatusId === a.id ? "…" : a.status.replace("_", " ")}
                                          </Badge>
                                        </button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end" className="min-w-36">
                                        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                                          Set status
                                        </DropdownMenuLabel>
                                        <DropdownMenuSeparator />
                                        {SHIFT_STATUS_OPTIONS.map((opt) => (
                                          <DropdownMenuItem
                                            key={opt.value}
                                            onClick={() => handleQuickStatusChange(a, opt.value)}
                                            className={opt.value === a.status ? "font-semibold" : undefined}
                                          >
                                            {opt.label}
                                          </DropdownMenuItem>
                                        ))}
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                </div>
                              );
                            })}
                            {isDraft && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-full h-7 text-xs text-muted-foreground"
                                onClick={() => openAddDialog(row.unitId, d)}
                              >
                                <Plus className="h-3 w-3 mr-1" />
                                Add
                              </Button>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Add shift dialog */}
      <Dialog open={!!addTarget} onOpenChange={(o) => !o && setAddTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Shift</DialogTitle>
            <DialogDescription>
              {addTarget && `${rows.find((r) => r.key === (addTarget.unitId ?? UNASSIGNED))?.name} · ${formatDateLabel(addTarget.date)}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label id={`${__fieldIds}-employees-selected`}>Employees * ({addEmployeeIds.size} selected)</Label>
              <div role="group" aria-labelledby={`${__fieldIds}-employees-selected`} className="border rounded-md overflow-hidden">
                <label className="flex items-center gap-2 px-2.5 py-1.5 text-xs border-b bg-muted/40 cursor-pointer">
                  <Checkbox
                    checked={allAddEmployeesSelected ? true : someAddEmployeesSelected ? "indeterminate" : false}
                    onCheckedChange={toggleSelectAllAddEmployees}
                    aria-label="Select all visible employees"
                  />
                  <span className="text-muted-foreground">Select all eligible ({eligibleCandidates.length})</span>
                </label>
                <div className="max-h-48 overflow-y-auto divide-y">
                  {eligibilityPreview.isLoading ? (
                    <p className="text-xs text-muted-foreground text-center py-4">Checking qualifications, availability, rest, and hours...</p>
                  ) : eligibilityPreview.isError ? (
                    <p className="text-xs text-destructive text-center py-4">Eligibility preview failed: {eligibilityPreview.error.message}</p>
                  ) : (eligibilityPreview.data ?? []).length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">No employees are assigned to this facility.</p>
                  ) : (
                    (eligibilityPreview.data ?? []).map((candidate) => {
                      const badge = eligibilityBadge(candidate);
                      return (
                      <div key={candidate.employeeId} className="px-2.5 py-2 text-sm space-y-1.5">
                        <label className={`flex items-center gap-2 ${candidate.outcome === "blocked" ? "cursor-not-allowed opacity-75" : "cursor-pointer"}`}>
                        <Checkbox
                          checked={addEmployeeIds.has(candidate.employeeId)}
                          disabled={candidate.outcome === "blocked"}
                          onCheckedChange={() => toggleAddEmployee(candidate.employeeId)}
                        />
                        <span className="flex-1 truncate">
                          {candidate.employeeName}
                          {candidate.jobTitle ? <span className="text-xs text-muted-foreground"> &middot; {candidate.jobTitle}</span> : null}
                        </span>
                        <Badge variant="outline" className={`text-[10px] ${badge.className}`}>{badge.label}</Badge>
                      </label>
                        {[...candidate.hardBlocks, ...candidate.warnings].length > 0 && (
                          <div className="pl-6 space-y-1">
                            {[...candidate.hardBlocks, ...candidate.warnings].map((code) => (
                              <div key={code} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                                <span>{explainEligibilityCode(code)}</span>
                                {candidate.hardBlocks.includes(code) && !NON_OVERRIDABLE_BLOCKS.has(code) && (
                                  <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => openOverride(candidate, code)}>
                                    Request override
                                  </Button>
                                )}
                              </div>
                            ))}
                            {candidate.appliedOverrideIds.length > 0 && (
                              <p className="text-[11px] text-amber-700">Authorized bounded override applied; assignment remains a warning.</p>
                            )}
                          </div>
                        )}
                      </div>
                      );
                    })
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Blocked employees cannot be selected. Every accepted assignment stores the eligibility decision used.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${__fieldIds}-shift`}>Shift *</Label>
              <Select value={addForm.shiftDefinitionId} onValueChange={(v) => setAddForm((f) => ({ ...f, shiftDefinitionId: v }))}>
                <SelectTrigger id={`${__fieldIds}-shift`}><SelectValue placeholder="Select shift" /></SelectTrigger>
                <SelectContent>
                  {activeShiftDefs.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({formatTimeLabel(s.start_time)}–{formatTimeLabel(s.end_time)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${__fieldIds}-notes`}>Notes</Label>
              <Textarea id={`${__fieldIds}-notes`} rows={2} value={addForm.notes} onChange={(e) => setAddForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddTarget(null)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={isAddingShifts || addEmployeeIds.size === 0}>
              {isAddingShifts
                ? "Adding..."
                : addEmployeeIds.size > 1
                  ? `Add Shift to ${addEmployeeIds.size} Employees`
                  : "Add Shift"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!overrideTarget} onOpenChange={(open) => !open && setOverrideTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Authorize bounded override</DialogTitle>
            <DialogDescription>
              {overrideTarget?.candidate.employeeName} &middot; {overrideTarget ? explainEligibilityCode(overrideTarget.blockCode) : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              This override applies only to the selected shift type and expires automatically. Employment inactivity, confirmed exclusions, facility assignment, and overlap blocks cannot be overridden.
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${__fieldIds}-reason`}>Reason *</Label>
              <Textarea id={`${__fieldIds}-reason`} rows={3} value={overrideForm.reason} onChange={(event) => setOverrideForm((form) => ({ ...form, reason: event.target.value }))} placeholder="Why is this exception safe and necessary?" />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${__fieldIds}-authority-reference`}>Authority reference *</Label>
              <Input id={`${__fieldIds}-authority-reference`} value={overrideForm.authorityReference} onChange={(event) => setOverrideForm((form) => ({ ...form, authorityReference: event.target.value }))} placeholder="Policy, approval, or incident reference" />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${__fieldIds}-expires`}>Expires *</Label>
              <Input id={`${__fieldIds}-expires`} type="datetime-local" value={overrideForm.expiresAt} onChange={(event) => setOverrideForm((form) => ({ ...form, expiresAt: event.target.value }))} />
            </div>
            <p className="text-xs text-muted-foreground">Your profile is recorded as the approver. Current workforce-administration identity assurance is required.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideTarget(null)}>Cancel</Button>
            <Button
              onClick={handleCreateOverride}
              disabled={createOverride.isPending || overrideForm.reason.trim().length < 8 || overrideForm.authorityReference.trim().length < 3 || !overrideForm.expiresAt}
            >
              {createOverride.isPending ? "Authorizing..." : "Authorize Override"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit shift dialog */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editTarget && `${editTarget.employees?.first_name} ${editTarget.employees?.last_name}`}
            </DialogTitle>
            <DialogDescription>{editTarget && formatDateLabel(editTarget.shift_date)}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor={`${__fieldIds}-unit`}>Unit</Label>
                <Select value={editForm.unitId} onValueChange={(v) => setEditForm((f) => ({ ...f, unitId: v }))}>
                  <SelectTrigger id={`${__fieldIds}-unit`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                    {activeUnits.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${__fieldIds}-shift-2`}>Shift</Label>
                <Select value={editForm.shiftDefinitionId} onValueChange={(v) => setEditForm((f) => ({ ...f, shiftDefinitionId: v }))}>
                  <SelectTrigger id={`${__fieldIds}-shift-2`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {activeShiftDefs.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${__fieldIds}-status`}>Status</Label>
              <Select value={editForm.status} onValueChange={(v) => setEditForm((f) => ({ ...f, status: v }))}>
                <SelectTrigger id={`${__fieldIds}-status`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SHIFT_STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${__fieldIds}-notes-2`}>Notes</Label>
              <Textarea id={`${__fieldIds}-notes-2`} rows={2} value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter className="flex items-center sm:justify-between">
            <Button variant="destructive" onClick={handleDelete} disabled={deleteAssignment.isPending}>
              Remove Shift
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
              <Button onClick={handleEditSave} disabled={updateAssignment.isPending}>Save</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear auto-filled shifts?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes every shift that Auto-Fill added and hasn't been touched since. Manually added or
              edited shifts are never affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearAutoFill}>Clear</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDeleteSchedule} onOpenChange={setConfirmDeleteSchedule}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this schedule?</AlertDialogTitle>
            <AlertDialogDescription>
              {assignments?.length
                ? `This removes the schedule and its ${assignments.length} shift assignment${assignments.length === 1 ? "" : "s"}. Nobody has been shown them -- a draft is not visible under My Schedule -- but they cannot be recovered.`
                : "This removes the schedule. It has no shift assignments."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteSchedule.mutate(schedule.id, {
                onSuccess: () => { toast({ title: "Schedule deleted" }); navigate("/app/schedule"); },
                onError: (error) => toast({ title: "Could not delete the schedule", description: error instanceof Error ? error.message : String(error), variant: "destructive" }),
              })}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
