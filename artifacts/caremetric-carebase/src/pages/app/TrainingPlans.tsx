import { boundedSettled } from "@/lib/boundedSettled";
import { PlanAuthoringTools } from "@/components/training/PlanAuthoringTools";
import { FacilityTrainingStarterKits } from "@/components/training/TrainingStarterKits";
import { TrainingAssignmentRules } from "@/components/training/TrainingAssignmentRules";
import YearlyPlanProgress from "@/components/training/YearlyPlanProgress";
import { useId, Fragment, useMemo, useState } from "react";
import { useSearch } from "wouter";
import {
  useListTrainingPlans,
  useCreateTrainingPlan,
  useUpdateTrainingPlan,
  useDeleteTrainingPlan,
  useListTrainingPlanItems,
  useAddTrainingPlanItem,
  useUpdateTrainingPlanItem,
  useRemoveTrainingPlanItem,
  useApplyTrainingPlanToEmployee,
  type TrainingPlan,
  type TrainingPlanItem,
  type AddTrainingPlanItemPayload,
} from "@/hooks/useTrainingPlans";
import { useListCourses } from "@/hooks/useCourses";
import { useListTrainingTypes } from "@/hooks/useTrainingTypes";
import { useListEmployees } from "@/hooks/useEmployees";
import { useListCourseAssignments, type CourseAssignment } from "@/hooks/useCourseAssignments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  ListChecks, Plus, Pencil, Trash2, Search, ChevronDown, ChevronRight,
  ArrowUp, ArrowDown, BookOpen, ShieldCheck, UserPlus,
} from "lucide-react";
import { QueryError } from "@/components/QueryState";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useListFacilities } from "@/hooks/useFacilities";
import { useTrainingFacilityScope } from "@/hooks/useFacilityAssignments";
import { useViewingOrg } from "@/lib/viewingOrg";
import { formatDateForDisplay } from "@/lib/dateUtils";
import { canManageTrainingPlan, isExplicitCompletionDeadline, trainingPlanErrorMessage, yearlyPlanInputError } from "@/lib/trainingPlanEditing";

interface PlanFormData {
  name: string;
  description: string;
  facilityId: string;
  trainingYear: string;
  dueDate: string;
}

const EMPTY_PLAN_FORM: PlanFormData = { name: "", description: "", facilityId: "", trainingYear: "", dueDate: "" };

interface AddItemFormData {
  targetType: "course" | "training_type";
  targetId: string;
  isRequired: boolean;
}

const EMPTY_ADD_ITEM_FORM: AddItemFormData = { targetType: "course", targetId: "", isRequired: true };

// ---------------------------------------------------------------------------
// Item type badge -- a plan item points at EITHER a course OR a legacy
// training_type, never both (enforced by a DB check constraint and by the
// AddTrainingPlanItemPayload discriminated union in useTrainingPlans.ts).
// ---------------------------------------------------------------------------
function ItemTypeBadge({ isCourse }: { isCourse: boolean }) {
  return isCourse ? (
    <Badge variant="outline" className="bg-info text-info-foreground">
      <BookOpen className="h-3 w-3 mr-1" /> Course
    </Badge>
  ) : (
    <Badge variant="outline" className="bg-secondary text-secondary-foreground">
      <ShieldCheck className="h-3 w-3 mr-1" /> Training Type
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Apply-to-employee(s) dialog
//
// Apply once per selected employee. Yearly plans use an atomic server reconciliation;
// legacy templates retain their existing course/requirement fan-out in the hook.
// ---------------------------------------------------------------------------
function ApplyPlanDialog({ plan, open, onClose }: { plan: TrainingPlan; open: boolean; onClose: () => void }) {
  const fieldId = useId();
  const { user } = useAuth();
  const annual = !!plan.facility_id;
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState(false);
  const planItems = useListTrainingPlanItems(open ? plan.id : undefined);
  const [outcome, setOutcome] = useState<{ summary: string; issues: string[] } | null>(null);
  const directory = useListFacilities({ organizationId: plan.organization_id });
  const scope = useTrainingFacilityScope(directory);
  const allowedFacilities = scope.facilities.filter(f => f.is_active && (!annual || f.id === plan.facility_id));
  const allowedIds = new Set(allowedFacilities.map(f => f.id));
  const employeesQuery = useListEmployees({ status: "active", organizationId: plan.organization_id,
    facilityId: plan.facility_id ?? undefined }, { enabled: open && scope.isReady && allowedIds.size > 0 });
  const employees = (employeesQuery.data ?? []).filter(e => allowedIds.has(e.facility_id));
  const employeeById = new Map(employees.map(e => [e.id, e]));
  const { mutateAsync: applyPlan } = useApplyTrainingPlanToEmployee();
  const targets = selectedIds.filter(id => employeeById.has(id));
  const filtered = employees.filter(e => `${e.first_name} ${e.last_name}`.toLowerCase().includes(search.toLowerCase()));
  const allSelected = filtered.length > 0 && filtered.every(e => targets.includes(e.id));
  const ready = scope.isReady && !employeesQuery.isLoading && !employeesQuery.isError && allowedIds.size > 0;
  const handleClose = () => {
    if (applying) return;
    setSelectedIds([]); setSearch(""); setDueDate(""); setOutcome(null); setPreview(false); onClose();
  };
  const handleApply = async () => {
    if (!ready || !targets.length || !user || (!annual && !isExplicitCompletionDeadline(dueDate))) return;
    setPreview(false); setApplying(true); setOutcome(null);
    const results = await boundedSettled(targets, 4, employeeId => applyPlan({
      planId: plan.id, employeeId, facilityId: employeeById.get(employeeId)!.facility_id,
      organizationId: plan.organization_id, assignedBy: user.id, dueDate: annual ? plan.due_date : dueDate,
    }));
    let assigned = 0, updated = 0, canceled = 0, completed = 0, alreadyAssigned = 0, requirements = 0;
    const issues: string[] = [];
    results.forEach((result, index) => {
      const employee = employeeById.get(targets[index])!;
      const name = `${employee.first_name} ${employee.last_name}`;
      if (result.status === "rejected") {
        issues.push(`${name}: ${trainingPlanErrorMessage(result.reason)}`);
        return;
      }
      const value = result.value;
      assigned += value.assigned; updated += value.updated ?? 0; canceled += value.canceled ?? 0;
      completed += value.alreadyCompleted ?? 0; alreadyAssigned += value.alreadyAssigned ?? 0;
      requirements += value.requirementsEnsured;
      value.failed.forEach(f => issues.push(`${name} — ${f.itemLabel ?? "Plan item"}: ${f.message}`));
      value.conflicts?.forEach(c => issues.push(`${name} — ${c.title}: already assigned outside this plan; existing deadline ${c.due_date ? formatDateForDisplay(c.due_date) : "not set"} was preserved.`));
      if (value.alertWarning) issues.push(`${name}: ${value.alertWarning}`);
    });
    setOutcome({ summary: annual
      ? `${assigned} assignments created; ${updated} deadlines updated; ${canceled} removed-course assignments canceled; ${completed} completed assignments preserved.`
      : `${assigned} assignments created; ${alreadyAssigned} already assigned; ${requirements} requirements tracked.`, issues });
    setApplying(false);
  };
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] flex flex-col overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Apply "{plan.name}" to Employees</DialogTitle>
          <DialogDescription>{annual
            ? "Apply the saved courses and completion deadline to the selected employees. Reapplying updates this plan’s unfinished assignments, cancels its removed courses and preserves completed training. Assignments outside this plan are left unchanged."
            : "Assign each course and track each training requirement for the selected employees. Existing open assignments keep their deadline."}</DialogDescription>
        </DialogHeader>
        {annual ? <p className="text-sm">Completion deadline: {formatDateForDisplay(plan.due_date)}</p> : (
          <div className="space-y-1.5"><Label htmlFor={`${fieldId}-deadline`}>Completion deadline *</Label>
            <Input id={`${fieldId}-deadline`} type="date" value={dueDate} disabled={applying} onChange={e => setDueDate(e.target.value)} required /></div>
        )}
        {outcome && <div role="status" className="rounded-md border p-3 space-y-2">
          <p className="font-medium">{outcome.summary}</p>
          {outcome.issues.length > 0 && <><p>Needs attention:</p><ul className="list-disc pl-5 space-y-1">{outcome.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul></>}
        </div>}
        {scope.isError ? <QueryError what="authorized facilities" error={scope.error} onRetry={scope.refetch} />
          : scope.isLoading ? <p>Loading authorized facilities…</p>
          : allowedIds.size === 0 ? <p>No active authorized facility is available for this plan.</p>
          : employeesQuery.isError ? <QueryError what="employees" error={employeesQuery.error} onRetry={() => void employeesQuery.refetch()} /> : <>
            <Input aria-label="Search employees" placeholder="Search employees..." value={search} disabled={applying} onChange={e => setSearch(e.target.value)} />
            <label className="flex items-center gap-2"><Checkbox checked={allSelected} disabled={!ready || !filtered.length || applying}
              onCheckedChange={checked => { setPreview(false); setSelectedIds(ids => checked ? [...new Set([...ids, ...filtered.map(e => e.id)])] : ids.filter(id => !filtered.some(e => e.id === id))); }} />
              <span>{annual ? "Select all matching employees in this facility" : "Select all matching employees"}</span></label>
            <div className="overflow-y-auto border rounded-md max-h-[250px]">
              {employeesQuery.isLoading ? <p className="p-4">Loading employees…</p> : filtered.length === 0 ? <p className="p-4">No active employees found.</p> : filtered.map(emp => (
                <label key={emp.id} className="flex items-center gap-3 px-4 py-3 border-b hover:bg-muted/50">
                  <Checkbox aria-label={`${emp.first_name} ${emp.last_name}`} checked={targets.includes(emp.id)} disabled={applying}
                    onCheckedChange={checked => { setPreview(false); setSelectedIds(ids => checked ? [...new Set([...ids, emp.id])] : ids.filter(id => id !== emp.id)); }} />
                  <span>{emp.first_name} {emp.last_name}</span>
                </label>
              ))}
            </div>
          </>}
        {preview && <section className="rounded border p-3 space-y-2" aria-label="Assignment preview"><h3 className="font-semibold">Review assignment changes</h3>
          <p>{planItems.data?.length ?? 0} current plan items for {targets.length} employees. Completion deadline: {formatDateForDisplay(annual ? plan.due_date : dueDate)}.</p>
          <p>Existing completed work remains in history. Unfinished courses removed from this plan will be canceled; existing individual or other-plan assignments will be listed as conflicts for your review.</p>
          <ul className="max-h-36 overflow-y-auto list-disc pl-5">{targets.map(id => <li key={id}>{employeeById.get(id)?.first_name} {employeeById.get(id)?.last_name}</li>)}</ul>
        </section>}
        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={applying}>{outcome ? "Close" : "Cancel"}</Button>
          <Button onClick={() => { if (preview) void handleApply(); else setPreview(true); }} disabled={!ready || !targets.length || applying || planItems.isLoading || planItems.isError || (!annual && !isExplicitCompletionDeadline(dueDate))}>
            {applying ? "Applying..." : preview ? `Confirm apply to ${targets.length} Employee${targets.length !== 1 ? "s" : ""}` : `Preview ${targets.length} Employee${targets.length !== 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Per-employee progress against this plan, once it's been applied to anyone.
// course_assignments.training_plan_id links a fanned-out assignment back to
// the plan that created it -- previously nothing surfaced that link, so an
// admin had no way to see who's on a plan or how far along they are.
// ---------------------------------------------------------------------------
function PlanProgressSection({ plan }: { plan: TrainingPlan }) {
  const { data: assignments, isLoading, isError, error, refetch } = useListCourseAssignments({ trainingPlanId: plan.id });
  const { data: employees } = useListEmployees({ status: "active" });
  const { data: courses } = useListCourses();

  const employeeById = useMemo(() => new Map((employees ?? []).map((e) => [e.id, e])), [employees]);
  const courseById = useMemo(() => new Map((courses ?? []).map((c) => [c.id, c])), [courses]);

  const byEmployee = useMemo(() => {
    const map = new Map<string, CourseAssignment[]>();
    for (const a of assignments ?? []) {
      const list = map.get(a.employee_id) ?? [];
      list.push(a);
      map.set(a.employee_id, list);
    }
    return map;
  }, [assignments]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(2)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded" />)}
      </div>
    );
  }

  if (isError) {
    return <QueryError what="plan progress" error={error} onRetry={() => void refetch()} />;
  }

  if (byEmployee.size === 0) {
    return <p className="text-xs text-muted-foreground italic">This plan hasn't been applied to any employees yet.</p>;
  }

  return (
    <div className="space-y-2">
      {[...byEmployee.entries()].map(([employeeId, rows]) => {
        const employee = employeeById.get(employeeId);
        const completed = rows.filter((r) => r.status === "completed").length;
        const enrolled = rows.filter((r) => r.status !== "canceled").length;
        return (
          <div key={employeeId} className="p-3 rounded-lg border bg-card">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="font-medium text-sm">
                {employee ? `${employee.first_name} ${employee.last_name}` : `Employee #${employeeId.slice(0, 8)}`}
              </span>
              <Badge variant={enrolled > 0 && completed === enrolled ? "default" : "secondary"} className="text-[10px]">
                {completed} / {enrolled} complete
              </Badge>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {rows.map((r) => (
                <Badge key={r.id} variant="outline" className="text-[10px]">
                  {courseById.get(r.course_id)?.title ?? "Training item"} — {r.status.replace(/_/g, " ")}
                </Badge>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expanded plan detail: items list + add/remove/reorder + apply action.
// ---------------------------------------------------------------------------
function TrainingPlanItemsPanel({ plan, canManage }: { plan: TrainingPlan; canManage: boolean }) {
  const __fieldIds = useId();
  const annual = !!plan.facility_id;
  const { toast } = useToast();

  const { data: items, isLoading, isError, error, refetch } = useListTrainingPlanItems(plan.id);
  const { data: courses } = useListCourses();
  const { data: trainingTypes } = useListTrainingTypes({ isActive: true });

  const { mutate: addItem, isPending: addingItem } = useAddTrainingPlanItem();
  const { mutateAsync: updateItem, isPending: updatingItem } = useUpdateTrainingPlanItem();
  const { mutate: removeItem, isPending: removingItem } = useRemoveTrainingPlanItem();

  const [showAddItem, setShowAddItem] = useState(false);
  const [addItemForm, setAddItemForm] = useState<AddItemFormData>(EMPTY_ADD_ITEM_FORM);
  const [itemPendingDelete, setItemPendingDelete] = useState<TrainingPlanItem | null>(null);
  const [reorderingId, setReorderingId] = useState<string | null>(null);
  const [showApplyDialog, setShowApplyDialog] = useState(false);

  const courseById = useMemo(() => new Map((courses ?? []).map((c) => [c.id, c])), [courses]);
  const trainingTypeById = useMemo(() => new Map((trainingTypes ?? []).map((t) => [t.id, t])), [trainingTypes]);

  const sortedItems = useMemo(() => (items ?? []).slice().sort((a, b) => a.sort_order - b.sort_order), [items]);

  const openAddItem = () => {
    setAddItemForm(EMPTY_ADD_ITEM_FORM);
    setShowAddItem(true);
  };

  const handleAddItem = () => {
    if (!addItemForm.targetId) {
      toast({ title: "Select training content or a training type", variant: "destructive" });
      return;
    }
    const nextSort = (sortedItems.reduce((max, i) => Math.max(max, i.sort_order), -1)) + 1;
    const payload: AddTrainingPlanItemPayload =
      addItemForm.targetType === "course"
        ? { training_plan_id: plan.id, course_id: addItemForm.targetId, sort_order: nextSort, is_required: addItemForm.isRequired }
        : { training_plan_id: plan.id, training_type_id: addItemForm.targetId, sort_order: nextSort, is_required: addItemForm.isRequired };

    addItem(payload, {
      onSuccess: () => { toast({ title: "Item added to plan" }); setShowAddItem(false); },
      onError: (e: Error) => toast({ title: "Failed to add item", description: e.message, variant: "destructive" }),
    });
  };

  const handleRemoveItem = () => {
    if (!itemPendingDelete) return;
    removeItem(
      { id: itemPendingDelete.id, trainingPlanId: plan.id },
      {
        onSuccess: () => { toast({ title: "Item removed" }); setItemPendingDelete(null); },
        onError: (e: Error) => toast({ title: "Failed to remove item", description: e.message, variant: "destructive" }),
      },
    );
  };

  const moveItem = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= sortedItems.length) return;
    const current = sortedItems[index];
    const swapWith = sortedItems[targetIndex];
    setReorderingId(current.id);
    try {
      await Promise.all([
        updateItem({ id: current.id, trainingPlanId: plan.id, sort_order: swapWith.sort_order }),
        updateItem({ id: swapWith.id, trainingPlanId: plan.id, sort_order: current.sort_order }),
      ]);
    } catch (e) {
      toast({ title: "Failed to reorder", description: (e as Error).message, variant: "destructive" });
    } finally {
      setReorderingId(null);
    }
  };

  return (
    <div className="p-4 bg-muted/20 space-y-4">
      {annual && <p className="text-sm text-muted-foreground">Course and deadline edits take effect when you apply this plan again. Completed training remains in each employee’s history.</p>}
      {annual && canManage && <TrainingAssignmentRules plan={plan} />}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-foreground">Plan Items</h3>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && <PlanAuthoringTools plan={plan} items={items ?? []} />}
          {canManage && (
            <Button size="sm" variant="outline" onClick={() => setShowApplyDialog(true)}>
              <UserPlus className="mr-2 h-3.5 w-3.5" /> Apply to Employee(s)
            </Button>
          )}
          {canManage && (
            <Button size="sm" onClick={openAddItem}>
              <Plus className="mr-2 h-3.5 w-3.5" /> Add Item
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-11 bg-muted animate-pulse rounded" />)}
        </div>
      ) : isError ? (
        <QueryError what="plan items" error={error} onRetry={() => void refetch()} />
      ) : sortedItems.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm text-muted-foreground">No items in this plan yet.</p>
          {canManage && (
            <p className="text-xs text-muted-foreground/70 mt-1">Add training content or a training type to get started.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {sortedItems.map((item, idx) => {
            const isCourse = item.course_id !== null;
            const itemCourse = isCourse ? courseById.get(item.course_id!) : undefined;
            const label = isCourse
              ? itemCourse?.title ?? `Course #${item.course_id!.slice(0, 8)}`
              : trainingTypeById.get(item.training_type_id!)?.name ?? `Training Type #${item.training_type_id!.slice(0, 8)}`;
            // A course can be unpublished or archived after the plan was built. Applying the plan
            // then refuses this item for every selected employee, so the plan has to show it here
            // rather than at the end of a fan-out (BACKLOG.md J74, Train).
            const notAssignable = isCourse && !!itemCourse
              && (itemCourse.status !== "published" || !itemCourse.current_version_id);
            return (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border bg-card">
                <div className="flex items-center gap-3 min-w-0">
                  <ItemTypeBadge isCourse={isCourse} />
                  <span className="font-medium text-sm truncate">{label}</span>
                  {item.is_required ? (
                    <Badge variant="secondary" className="text-[10px] font-medium">Required</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] font-medium">Optional</Badge>
                  )}
                  {notAssignable && (
                    <Badge variant="destructive" className="text-[10px] font-medium">
                      {itemCourse?.status !== "published" ? `${itemCourse?.status} — will not apply` : "no published version"}
                    </Badge>
                  )}
                </div>
                {canManage && (
                  <div className="flex flex-wrap items-center justify-end gap-0.5 shrink-0">
                    <Button size="sm" variant="ghost" disabled={updatingItem} aria-label={`Make ${label} ${item.is_required ? "optional" : "required"}`} onClick={async () => {
                      try { await updateItem({ id: item.id, trainingPlanId: plan.id, is_required: !item.is_required }); toast({ title: "Requirement updated", description: "Review plan coverage and reapply to enrolled staff." }); }
                      catch (error) { toast({ title: "Could not change requirement", description: (error as Error).message, variant: "destructive" }); }
                    }}>{item.is_required ? "Make optional" : "Make required"}</Button>
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      onClick={() => moveItem(idx, -1)}
                      disabled={idx === 0 || reorderingId !== null}
                      aria-label="Move up"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      onClick={() => moveItem(idx, 1)}
                      disabled={idx === sortedItems.length - 1 || reorderingId !== null}
                      aria-label="Move down"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => setItemPendingDelete(item)}
                      aria-label="Remove item"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="pt-2 border-t">
        <h3 className="text-sm font-semibold text-foreground mb-2">Applied To</h3>
        {annual ? <YearlyPlanProgress planId={plan.id} canManage={canManage} /> : <PlanProgressSection plan={plan} />}
      </div>

      <Dialog open={showAddItem} onOpenChange={(o) => { if (!o) { setShowAddItem(false); setAddItemForm(EMPTY_ADD_ITEM_FORM); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Plan Item</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${__fieldIds}-item-type`} className="text-[13px]">Item Type</Label>
              <Select
                value={addItemForm.targetType}
                disabled={annual}
                onValueChange={(v) => setAddItemForm((f) => ({ ...f, targetType: v as AddItemFormData["targetType"], targetId: "" }))}
              >
                <SelectTrigger id={`${__fieldIds}-item-type`} className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="course">Online training content</SelectItem>
                  <SelectItem value="training_type">Training Type (legacy)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {addItemForm.targetType === "course" ? (
              <div className="space-y-1.5">
                <Label htmlFor={`${__fieldIds}-training-content`} className="text-[13px]">Training content *</Label>
                <Select value={addItemForm.targetId} onValueChange={(v) => setAddItemForm((f) => ({ ...f, targetId: v }))}>
                  <SelectTrigger id={`${__fieldIds}-training-content`} className="h-9"><SelectValue placeholder="Select training content" /></SelectTrigger>
                  <SelectContent>
                    {/* A draft or archived course could be added to a plan, and applying the plan
                        then failed once per employee with `validate_course_assignment_version`'s raw
                        trigger sentence. It stays listed so the author can see it is there, but it
                        cannot be chosen while the database would refuse it (BACKLOG.md J74, Train). */}
                    {(courses ?? []).filter(c => !sortedItems.some(item => item.course_id === c.id) && (!c.organization_id || c.organization_id === plan.organization_id)).map((c) => {
                      const assignable = c.status === "published" && !!c.current_version_id;
                      return (
                        <SelectItem key={c.id} value={c.id} disabled={!assignable}>
                          {c.title}
                          {c.status !== "published"
                            ? ` — ${c.status}, cannot be assigned`
                            : !c.current_version_id
                              ? " — no published version"
                              : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor={`${__fieldIds}-training-type`} className="text-[13px]">Training Type *</Label>
                <Select value={addItemForm.targetId} onValueChange={(v) => setAddItemForm((f) => ({ ...f, targetId: v }))}>
                  <SelectTrigger id={`${__fieldIds}-training-type`} className="h-9"><SelectValue placeholder="Select training type" /></SelectTrigger>
                  <SelectContent>
                    {(trainingTypes ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {!annual && <label className="flex items-center gap-2.5 cursor-pointer">
              <Checkbox
                checked={addItemForm.isRequired}
                onCheckedChange={(checked) => setAddItemForm((f) => ({ ...f, isRequired: !!checked }))}
              />
              <span className="text-[13px]">Required</span>
            </label>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddItem(false)}>Cancel</Button>
            <Button onClick={handleAddItem} disabled={addingItem}>{addingItem ? "Adding..." : "Add Item"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!itemPendingDelete} onOpenChange={(o) => { if (!o) setItemPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Plan Item</AlertDialogTitle>
            <AlertDialogDescription>
              {annual ? "This removes the course from the plan. Apply the plan again to cancel its unfinished assignments for the employees you select. Completed training is preserved."
                : "This only removes the item from the plan template. Assignments already created by an earlier application remain unchanged."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemoveItem}
              disabled={removingItem}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removingItem ? "Removing..." : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ApplyPlanDialog plan={plan} open={showApplyDialog} onClose={() => setShowApplyDialog(false)} />
    </div>
  );
}

export default function TrainingPlans({ facilityId, embedded = false }: { facilityId?: string; embedded?: boolean } = {}) {
  const __fieldIds = useId();
  const { user } = useAuth();
  const { toast } = useToast();
  const { viewingOrgId } = useViewingOrg();
  const searchParams = useSearch();
  const organizationId = user?.role === "platform_admin" ? viewingOrgId ?? undefined : user?.organizationId ?? undefined;
  const directory = useListFacilities({ organizationId });
  const scope = useTrainingFacilityScope(directory);
  const facilities = scope.facilities.filter(f => f.is_active);
  const facilityIds = new Set(facilities.map(f => f.id));
  const [facilityFilter, setFacilityFilter] = useState("");
  const requestedFacility = facilityId || (facilityFilter === "all" ? "" : facilityFilter || new URLSearchParams(searchParams).get("facility") || "");
  const requestedUnavailable = !!requestedFacility && scope.isReady && !facilityIds.has(requestedFacility);
  const canCreatePlan = ["org_admin", "trainer", "facility_manager", "platform_admin"].includes(user?.role ?? "");
  const canManage = (plan: TrainingPlan) => scope.isReady
    && canManageTrainingPlan(user?.role, plan, user?.organizationId, facilityIds);
  const canDeletePlan = (plan: TrainingPlan) => canManage(plan)
    && (!!plan.facility_id || user?.role === "org_admin" || user?.role === "platform_admin");

  const [search, setSearch] = useState("");
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [editingPlan, setEditingPlan] = useState<TrainingPlan | null>(null);
  const [planForm, setPlanForm] = useState<PlanFormData>(EMPTY_PLAN_FORM);
  const [deleteTarget, setDeleteTarget] = useState<TrainingPlan | null>(null);

  const { data: plans, isLoading, isError, error, refetch } = useListTrainingPlans();
  const { mutate: createPlan, isPending: creatingPlan } = useCreateTrainingPlan();
  const { mutate: updatePlan, isPending: updatingPlan } = useUpdateTrainingPlan();
  const { mutate: deletePlan, isPending: deletingPlan } = useDeleteTrainingPlan();
  const priorAssignments = useListCourseAssignments({ trainingPlanId: editingPlan?.id }, { enabled: !!editingPlan?.facility_id });
  const annualForm = !editingPlan || !!editingPlan.facility_id;
  const lockPlanScope = !!editingPlan?.facility_id && (priorAssignments.isLoading || priorAssignments.isError || (priorAssignments.data?.length ?? 0) > 0);
  const formError = annualForm ? yearlyPlanInputError(planForm, facilityIds) : null;
  const savingPlan = creatingPlan || updatingPlan;
  const closePlanForm = () => {
    if (savingPlan) return;
    setShowPlanForm(false); setEditingPlan(null); setPlanForm(EMPTY_PLAN_FORM);
  };

  const allPlans = plans ?? [];
  const filtered = allPlans.filter((p) => {
    if (organizationId && p.organization_id !== organizationId) return false;
    if (requestedFacility && (requestedUnavailable || p.facility_id !== requestedFacility)) return false;
    if (embedded && !p.facility_id) return false;
    if (p.facility_id && !facilityIds.has(p.facility_id)) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return p.name.toLowerCase().includes(q) || (p.description ?? "").toLowerCase().includes(q);
  });

  const openCreate = () => {
    setEditingPlan(null);
    setPlanForm({ ...EMPTY_PLAN_FORM, facilityId: facilityIds.has(requestedFacility) ? requestedFacility : "" });
    setShowPlanForm(true);
  };

  const openEdit = (e: React.MouseEvent, plan: TrainingPlan) => {
    e.stopPropagation();
    setEditingPlan(plan);
    setPlanForm({ name: plan.name, description: plan.description ?? "", facilityId: plan.facility_id ?? "",
      trainingYear: plan.training_year?.toString() ?? "", dueDate: plan.due_date ?? "" });
    setShowPlanForm(true);
  };

  const handleSavePlan = () => {
    if (!planForm.name.trim()) {
      toast({ title: "Plan name is required", variant: "destructive" });
      return;
    }
    if (formError || !scope.isReady || (editingPlan && !canManage(editingPlan))) {
      toast({ title: formError ?? "This plan cannot be edited in the current facility scope.", variant: "destructive" });
      return;
    }
    const annualFields = annualForm ? { facility_id: planForm.facilityId, training_year: Number(planForm.trainingYear), due_date: planForm.dueDate } : {};
    if (editingPlan) {
      updatePlan(
        { id: editingPlan.id, name: planForm.name.trim(), description: planForm.description || null, ...annualFields },
        {
          onSuccess: () => { toast({ title: "Training plan updated" }); setShowPlanForm(false); setEditingPlan(null); },
          onError: (e: Error) => toast({ title: "Failed to update plan", description: e.message, variant: "destructive" }),
        },
      );
    } else if (user && canCreatePlan) {
      const facility = facilities.find(f => f.id === planForm.facilityId);
      if (!facility) return;
      createPlan(
        {
          name: planForm.name.trim(),
          description: planForm.description || null,
          organization_id: facility.organization_id,
          created_by: user.id,
          ...annualFields,
        },
        {
          onSuccess: plan => { toast({ title: "Training plan created" }); setExpandedPlanId(plan.id); setShowPlanForm(false); setPlanForm(EMPTY_PLAN_FORM); },
          onError: (e: Error) => toast({ title: "Failed to create plan", description: e.message, variant: "destructive" }),
        },
      );
    }
  };

  const handleDeletePlan = () => {
    if (!deleteTarget) return;
    deletePlan(deleteTarget.id, {
      onSuccess: () => {
        toast({ title: "Training plan deleted" });
        if (expandedPlanId === deleteTarget.id) setExpandedPlanId(null);
        setDeleteTarget(null);
      },
      onError: (e: Error) => toast({ title: "Failed to delete plan", description: e.message, variant: "destructive" }),
    });
  };

  const toggleExpanded = (planId: string) => setExpandedPlanId((cur) => (cur === planId ? null : planId));

  return (
    <div className="space-y-6">
      <div className="page-header flex flex-wrap items-center justify-between gap-3">
        <div>
          {embedded ? <h2 className="text-xl font-semibold">Training Plans</h2> : <h1>Training Plans</h1>}
          <p>Build a facility’s yearly course plan, enter its completion deadline, and assign it to employees together.</p>
        </div>
        {canCreatePlan && (
          <Button onClick={openCreate} disabled={!scope.isReady || !facilities.length || requestedUnavailable} className="shadow-sm">
            <Plus className="mr-2 h-4 w-4" /> New Plan
          </Button>
        )}
      </div>

      {canCreatePlan && scope.isReady && !requestedUnavailable && facilities.length > 0 && <FacilityTrainingStarterKits
        facilities={facilities} selectedFacility={requestedFacility || undefined} onCreated={id => {
          setExpandedPlanId(id); toast({ title: "Facility learning plan created", description: "Review the copied courses, then apply the plan or set a role-based assignment rule." });
        }} />}

      <div className="premium-card">
        <div className="filter-bar">
          {!embedded && <div className="space-y-1">
            <Label htmlFor={`${__fieldIds}-facility-filter`}>Training facility</Label>
            <select id={`${__fieldIds}-facility-filter`} value={requestedFacility || "all"} onChange={e => setFacilityFilter(e.target.value)} className="h-9 rounded-md border bg-card px-3 text-sm" disabled={!scope.isReady}>
              <option value="all">All authorized facilities and legacy plans</option>
              {requestedUnavailable && <option value={requestedFacility}>Unavailable facility</option>}
              {facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>}
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search training plans..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 bg-card"
            />
          </div>
        </div>

        {scope.isError ? <div className="p-6"><QueryError what="authorized facilities" error={scope.error} onRetry={scope.refetch} /></div>
        : requestedUnavailable ? <p role="alert" className="p-6">This facility is unavailable or outside your assigned facilities.</p>
        : isError ? (
          <div className="p-6">
            <QueryError what="training plans" error={error} onRetry={() => refetch()} />
          </div>
        ) : isLoading || scope.isLoading ? (
          <div className="p-6 space-y-3">
            {[...Array(4)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <ListChecks className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No training plans found</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              {search.trim() ? "Try adjusting your search" : canCreatePlan ? "Create your first plan to get started" : "Check back once a training plan has been created"}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table min-w-[640px]">
              <thead>
                <tr>
                  <th className="w-8" />
                  <th>Name</th>
                  <th>Description</th>
                  <th>Created</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((plan) => {
                  const isExpanded = expandedPlanId === plan.id;
                  return (
                    <Fragment key={plan.id}>
                      <tr className="cursor-pointer" onClick={() => toggleExpanded(plan.id)}>
                        <td>
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                        </td>
                        <td>
                          <button type="button" aria-expanded={isExpanded} onClick={e => { e.stopPropagation(); toggleExpanded(plan.id); }} className="font-medium text-foreground text-left">{plan.name}</button>
                          {plan.facility_id && <p className="text-xs text-muted-foreground">{facilities.find(f => f.id === plan.facility_id)?.name} · {plan.training_year} · due {formatDateForDisplay(plan.due_date)}</p>}
                        </td>
                        <td className="text-muted-foreground max-w-md truncate">
                          {plan.description || "—"}
                        </td>
                        <td className="text-muted-foreground">
                          {new Date(plan.created_at).toLocaleDateString()}
                        </td>
                        <td>
                          <div className="flex items-center gap-0.5 justify-end">
                            {canManage(plan) && (
                              <Button
                                variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                onClick={(e) => openEdit(e, plan)}
                                aria-label={`Edit ${plan.name}`}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {canDeletePlan(plan) && (
                              <Button
                                variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                onClick={(e) => { e.stopPropagation(); setDeleteTarget(plan); }}
                                aria-label={`Delete ${plan.name}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={5} className="p-0">
                            <TrainingPlanItemsPanel plan={plan} canManage={canManage(plan)} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <ListChecks className="h-4 w-4" />
        <span>{filtered.length} training plan{filtered.length !== 1 ? "s" : ""} total</span>
      </div>

      <Dialog open={showPlanForm} onOpenChange={o => { if (!o) closePlanForm(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingPlan ? "Edit Training Plan" : "New Training Plan"}</DialogTitle>
            <DialogDescription>{annualForm
              ? "Choose the facility and training year, then enter the completion deadline. Nothing is assigned until you apply the plan."
              : "Edit this reusable legacy training template."}</DialogDescription>
          </DialogHeader>
          <fieldset className="space-y-4 py-2" disabled={savingPlan}>
            {annualForm && <>
              <div className="space-y-1.5">
                <Label htmlFor={`${__fieldIds}-plan-facility`}>Facility *</Label>
                <select id={`${__fieldIds}-plan-facility`} value={planForm.facilityId}
                  disabled={embedded || lockPlanScope || !scope.isReady} required
                  onChange={e => setPlanForm(f => ({ ...f, facilityId: e.target.value }))}
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                  <option value="">Choose a facility</option>
                  {facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5"><Label htmlFor={`${__fieldIds}-plan-year`}>Training year *</Label>
                  <Input id={`${__fieldIds}-plan-year`} type="number" min={1990} max={2200} step={1} required value={planForm.trainingYear}
                    disabled={lockPlanScope} onChange={e => setPlanForm(f => ({ ...f, trainingYear: e.target.value }))} /></div>
                <div className="space-y-1.5"><Label htmlFor={`${__fieldIds}-plan-deadline`}>Completion deadline *</Label>
                  <Input id={`${__fieldIds}-plan-deadline`} type="date" required value={planForm.dueDate}
                    onChange={e => setPlanForm(f => ({ ...f, dueDate: e.target.value }))} /></div>
              </div>
              {editingPlan && <p className="text-sm text-muted-foreground">Apply the plan again after saving to update unfinished assignments. Facility and training year are fixed once the plan has been applied.</p>}
              {editingPlan && priorAssignments.isError && <QueryError what="plan assignment history" error={priorAssignments.error} onRetry={() => void priorAssignments.refetch()} />}
            </>}
            <div className="space-y-1.5">
              <Label htmlFor={`${__fieldIds}-name`} className="text-[13px]">Name *</Label>
              <Input id={`${__fieldIds}-name`}
                value={planForm.name}
                onChange={(e) => setPlanForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="New Hire Onboarding"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${__fieldIds}-description`} className="text-[13px]">Description</Label>
              <Textarea id={`${__fieldIds}-description`}
                value={planForm.description}
                onChange={(e) => setPlanForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="What this plan covers and who it's for"
                rows={3}
              />
            </div>
          </fieldset>
          <DialogFooter>
            <Button variant="outline" onClick={closePlanForm} disabled={savingPlan}>Cancel</Button>
            <Button onClick={handleSavePlan} disabled={savingPlan || !planForm.name.trim() || !!formError || !scope.isReady || (!!editingPlan?.facility_id && (priorAssignments.isLoading || priorAssignments.isError))} className="shadow-sm">
              {savingPlan ? "Saving..." : editingPlan ? "Save Changes" : "Create Plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Training Plan</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.facility_id
                ? `Delete "${deleteTarget.name}" and its courses? A yearly plan that has been applied cannot be deleted; edit its courses and apply it again instead.`
                : `Delete "${deleteTarget?.name}" and its items? Existing assignments from this legacy plan are preserved.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeletePlan}
              disabled={deletingPlan}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingPlan ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
