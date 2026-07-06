import { useMemo, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useGetSchedule, useGenerateScheduleAssignments, useClearAutoFilledAssignments, usePublishSchedule, useUnpublishSchedule } from "@/hooks/useSchedules";
import { useGetFacility } from "@/hooks/useFacilities";
import { useListFacilityUnits } from "@/hooks/useFacilityUnits";
import { useListShiftDefinitions } from "@/hooks/useShiftDefinitions";
import { useListEmployeeFacilityAssignments } from "@/hooks/useEmployeeFacilityAssignments";
import {
  useListShiftAssignments, useCreateShiftAssignment, useUpdateShiftAssignment, useDeleteShiftAssignment,
  type ShiftAssignmentWithDetails,
} from "@/hooks/useShiftAssignments";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Sparkles, Eraser, Send, Undo2, Plus, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { enumerateDatesIso, formatDateLabel, formatTimeLabel } from "@/lib/scheduleDates";

const UNASSIGNED = "__unassigned__";

export default function ScheduleDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: schedule, isLoading: scheduleLoading } = useGetSchedule(id);
  const facilityId = schedule?.facility_id;
  const { data: facility } = useGetFacility(facilityId);
  const { data: units } = useListFacilityUnits({ facilityId });
  const { data: shiftDefs } = useListShiftDefinitions({ facilityId });
  const { data: roster } = useListEmployeeFacilityAssignments({ facilityId });
  const { data: assignments, isLoading: assignmentsLoading } = useListShiftAssignments({ scheduleId: id });

  const generate = useGenerateScheduleAssignments();
  const clearAutoFill = useClearAutoFilledAssignments();
  const publish = usePublishSchedule();
  const unpublish = useUnpublishSchedule();
  const createAssignment = useCreateShiftAssignment();
  const updateAssignment = useUpdateShiftAssignment();
  const deleteAssignment = useDeleteShiftAssignment();

  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [addTarget, setAddTarget] = useState<{ unitId: string | null; date: string } | null>(null);
  const [editTarget, setEditTarget] = useState<ShiftAssignmentWithDetails | null>(null);

  const [addForm, setAddForm] = useState({ employeeId: "", shiftDefinitionId: "", notes: "" });
  const [editForm, setEditForm] = useState({ unitId: UNASSIGNED, shiftDefinitionId: "", status: "scheduled", notes: "" });

  const dates = useMemo(
    () => (schedule ? enumerateDatesIso(schedule.period_start, schedule.period_end) : []),
    [schedule]
  );

  const activeUnits = useMemo(() => (units ?? []).filter((u) => u.is_active), [units]);
  const activeShiftDefs = useMemo(() => (shiftDefs ?? []).filter((s) => s.is_active), [shiftDefs]);
  const activeRoster = useMemo(
    () => (roster ?? []).filter((r) => r.employees && r.employees.status === "active"),
    [roster]
  );

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

  const isDraft = schedule?.status === "draft";
  const hasAutoFill = (assignments ?? []).some((a) => a.source === "auto_fill" && a.status === "scheduled");

  function openAddDialog(unitId: string | null, date: string) {
    setAddForm({ employeeId: "", shiftDefinitionId: activeShiftDefs[0]?.id ?? "", notes: "" });
    setAddTarget({ unitId, date });
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

  function handleAdd() {
    if (!addTarget || !schedule || !addForm.employeeId || !addForm.shiftDefinitionId) {
      toast({ title: "Pick an employee and a shift", variant: "destructive" });
      return;
    }
    const shiftDef = activeShiftDefs.find((s) => s.id === addForm.shiftDefinitionId);
    if (!shiftDef) return;
    createAssignment.mutate(
      {
        organization_id: schedule.organization_id,
        schedule_id: schedule.id,
        facility_id: schedule.facility_id,
        employee_id: addForm.employeeId,
        unit_id: addTarget.unitId,
        shift_definition_id: shiftDef.id,
        shift_date: addTarget.date,
        start_time: shiftDef.start_time,
        end_time: shiftDef.end_time,
        status: "scheduled",
        source: "manual",
        notes: addForm.notes.trim() || null,
      },
      {
        onSuccess: () => {
          toast({ title: "Shift added" });
          setAddTarget(null);
        },
        onError: (e: Error) =>
          toast({
            title: "Couldn't add shift",
            description: e.message.includes("duplicate") ? "This employee already has a shift that day." : e.message,
            variant: "destructive",
          }),
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
        onError: (e: Error) => toast({ title: "Couldn't update shift", description: e.message, variant: "destructive" }),
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
    });
  }

  function handleGenerate() {
    if (!schedule) return;
    generate.mutate(schedule.id, {
      onSuccess: (result) => {
        toast({ title: "Auto-fill complete", description: `${result.inserted} shift(s) added, ${result.skipped} skipped (already had a shift that day).` });
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
    });
  }

  function handlePublishToggle() {
    if (!schedule) return;
    if (schedule.status === "draft") {
      publish.mutate(schedule.id, { onSuccess: () => toast({ title: "Schedule published -- employees can now see it" }) });
    } else {
      unpublish.mutate(schedule.id, { onSuccess: () => toast({ title: "Schedule moved back to draft" }) });
    }
  }

  if (scheduleLoading || !schedule) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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
            </>
          )}
          <Button onClick={handlePublishToggle} disabled={publish.isPending || unpublish.isPending}>
            {isDraft ? <Send className="h-4 w-4 mr-2" /> : <Undo2 className="h-4 w-4 mr-2" />}
            {isDraft ? "Publish" : "Move to Draft"}
          </Button>
        </div>
      </div>

      {!isDraft && (
        <p className="text-sm text-muted-foreground">
          This schedule is published -- employees assigned to it can see their shifts under My Schedule.
          Move it back to draft to auto-fill or bulk-edit.
        </p>
      )}

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
                            {cellAssignments.map((a) => (
                              <button
                                key={a.id}
                                type="button"
                                onClick={() => openEditDialog(a)}
                                className="w-full text-left rounded-md border px-2 py-1 hover:shadow-sm transition-shadow"
                                style={a.shift_definitions?.color ? { borderLeftColor: a.shift_definitions.color, borderLeftWidth: 3 } : undefined}
                              >
                                <div className="font-medium truncate">
                                  {a.employees?.first_name} {a.employees?.last_name}
                                </div>
                                <div className="text-xs text-muted-foreground flex items-center justify-between gap-1">
                                  <span className="truncate">{a.shift_definitions?.name ?? formatTimeLabel(a.start_time)}</span>
                                  {a.status !== "scheduled" && (
                                    <Badge variant={a.status === "called_off" || a.status === "no_show" ? "destructive" : "secondary"} className="text-[10px] px-1 py-0">
                                      {a.status.replace("_", " ")}
                                    </Badge>
                                  )}
                                </div>
                              </button>
                            ))}
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
              <Label>Employee *</Label>
              <Select value={addForm.employeeId} onValueChange={(v) => setAddForm((f) => ({ ...f, employeeId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {activeRoster.map((r) => (
                    <SelectItem key={r.employee_id} value={r.employee_id}>
                      {r.employees?.first_name} {r.employees?.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Shift *</Label>
              <Select value={addForm.shiftDefinitionId} onValueChange={(v) => setAddForm((f) => ({ ...f, shiftDefinitionId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select shift" /></SelectTrigger>
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
              <Label>Notes</Label>
              <Textarea rows={2} value={addForm.notes} onChange={(e) => setAddForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddTarget(null)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={createAssignment.isPending}>
              {createAssignment.isPending ? "Adding..." : "Add Shift"}
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
                <Label>Unit</Label>
                <Select value={editForm.unitId} onValueChange={(v) => setEditForm((f) => ({ ...f, unitId: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                    {activeUnits.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Shift</Label>
                <Select value={editForm.shiftDefinitionId} onValueChange={(v) => setEditForm((f) => ({ ...f, shiftDefinitionId: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {activeShiftDefs.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={editForm.status} onValueChange={(v) => setEditForm((f) => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="scheduled">Scheduled</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="called_off">Called Off</SelectItem>
                  <SelectItem value="no_show">No Show</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea rows={2} value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} />
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
    </div>
  );
}
