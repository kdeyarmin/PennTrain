import { Fragment, useMemo, useState } from "react";
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
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

interface PlanFormData {
  name: string;
  description: string;
}

const EMPTY_PLAN_FORM: PlanFormData = { name: "", description: "" };

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
// Loops useApplyTrainingPlanToEmployee() once per selected employee -- each
// call internally fans out over the plan's course-type items for that one
// employee (see the design note in useTrainingPlans.ts). This keeps the
// "employees" fan-out here in the page, next to the employee-picking UI,
// while the "plan items" fan-out lives in the hook, next to the plan data.
// ---------------------------------------------------------------------------
function ApplyPlanDialog({
  plan,
  open,
  onClose,
}: {
  plan: TrainingPlan;
  open: boolean;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);

  const { data: employees } = useListEmployees({ status: "active", organizationId: plan.organization_id });
  const { mutateAsync: applyPlan } = useApplyTrainingPlanToEmployee();

  const employeeById = useMemo(() => new Map((employees ?? []).map((e) => [e.id, e])), [employees]);

  const sortedEmployees = useMemo(
    () =>
      (employees ?? [])
        .slice()
        .sort((a, b) => `${a.last_name}${a.first_name}`.localeCompare(`${b.last_name}${b.first_name}`)),
    [employees],
  );

  const filteredEmployees = sortedEmployees.filter((e) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return `${e.first_name} ${e.last_name}`.toLowerCase().includes(q);
  });

  const toggle = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const handleClose = () => {
    setSelectedIds([]);
    setSearch("");
    onClose();
  };

  const handleApply = async () => {
    if (selectedIds.length === 0) return;
    setApplying(true);

    const targets = selectedIds.filter((id) => employeeById.has(id));
    const settled = await Promise.allSettled(
      targets.map((employeeId) => {
        const employee = employeeById.get(employeeId)!;
        return applyPlan({
          planId: plan.id,
          employeeId,
          facilityId: employee.facility_id,
          organizationId: plan.organization_id,
          assignedBy: user.id,
        });
      }),
    );

    setApplying(false);

    let succeededEmployees = 0;
    let failedEmployees = 0;
    let totalAssigned = 0;
    let totalRequirementsEnsured = 0;
    const issues: string[] = [];

    settled.forEach((result) => {
      if (result.status === "fulfilled") {
        succeededEmployees++;
        totalAssigned += result.value.assigned;
        totalRequirementsEnsured += result.value.requirementsEnsured;
        result.value.failed.forEach((f) => issues.push(`${f.itemLabel ?? "an item"}: ${f.message}`));
        if (result.value.alertWarning) issues.push(result.value.alertWarning);
      } else {
        failedEmployees++;
        issues.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
      }
    });

    const titleParts = [`Applied to ${succeededEmployees} employee${succeededEmployees !== 1 ? "s" : ""}`];
    if (failedEmployees > 0) titleParts.push(`${failedEmployees} failed`);

    let description = `${totalAssigned} training assignment${totalAssigned !== 1 ? "s" : ""} created.`;
    if (totalRequirementsEnsured > 0) {
      description += ` ${totalRequirementsEnsured} training requirement${totalRequirementsEnsured !== 1 ? "s" : ""} now tracked as pending.`;
    }
    if (issues.length > 0) {
      description += ` Issues: ${issues.slice(0, 3).join("; ")}${issues.length > 3 ? "…" : ""}`;
    }

    toast({
      title: titleParts.join(", "),
      description,
      variant: failedEmployees > 0 || issues.length > 0 ? "destructive" : undefined,
    });

    handleClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Apply "{plan.name}" to Employees</DialogTitle>
          <DialogDescription>
            Creates a training assignment for every course item in this plan, and tracks every training-type
            item as a pending requirement, for each employee selected below.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search employees..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex-1 overflow-y-auto border rounded-md max-h-[300px]">
          {filteredEmployees.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No active employees found.</p>
          ) : (
            <div className="divide-y">
              {filteredEmployees.map((emp) => (
                <label key={emp.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 cursor-pointer">
                  <Checkbox checked={selectedIds.includes(emp.id)} onCheckedChange={() => toggle(emp.id)} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{emp.first_name} {emp.last_name}</p>
                    <p className="text-xs text-muted-foreground truncate">{emp.job_title ?? "—"}</p>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button onClick={handleApply} disabled={selectedIds.length === 0 || applying}>
            {applying
              ? "Applying..."
              : `Apply to ${selectedIds.length} Employee${selectedIds.length !== 1 ? "s" : ""}`}
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
  const { data: assignments, isLoading } = useListCourseAssignments({ trainingPlanId: plan.id });
  const { data: employees } = useListEmployees();
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

  if (byEmployee.size === 0) {
    return <p className="text-xs text-muted-foreground italic">This plan hasn't been applied to any employees yet.</p>;
  }

  return (
    <div className="space-y-2">
      {[...byEmployee.entries()].map(([employeeId, rows]) => {
        const employee = employeeById.get(employeeId);
        const completed = rows.filter((r) => r.status === "completed").length;
        return (
          <div key={employeeId} className="p-3 rounded-lg border bg-card">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="font-medium text-sm">
                {employee ? `${employee.first_name} ${employee.last_name}` : `Employee #${employeeId.slice(0, 8)}`}
              </span>
              <Badge variant={completed === rows.length ? "default" : "secondary"} className="text-[10px]">
                {completed} / {rows.length} complete
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
  const { toast } = useToast();

  const { data: items, isLoading } = useListTrainingPlanItems(plan.id);
  const { data: courses } = useListCourses();
  const { data: trainingTypes } = useListTrainingTypes({ isActive: true });

  const { mutate: addItem, isPending: addingItem } = useAddTrainingPlanItem();
  const { mutateAsync: updateItem } = useUpdateTrainingPlanItem();
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
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-foreground">Plan Items</h3>
        <div className="flex items-center gap-2">
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
            const label = isCourse
              ? courseById.get(item.course_id!)?.title ?? `Course #${item.course_id!.slice(0, 8)}`
              : trainingTypeById.get(item.training_type_id!)?.name ?? `Training Type #${item.training_type_id!.slice(0, 8)}`;
            return (
              <div key={item.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-card">
                <div className="flex items-center gap-3 min-w-0">
                  <ItemTypeBadge isCourse={isCourse} />
                  <span className="font-medium text-sm truncate">{label}</span>
                  {item.is_required ? (
                    <Badge variant="secondary" className="text-[10px] font-medium">Required</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] font-medium">Optional</Badge>
                  )}
                </div>
                {canManage && (
                  <div className="flex items-center gap-0.5 shrink-0">
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
        <PlanProgressSection plan={plan} />
      </div>

      <Dialog open={showAddItem} onOpenChange={(o) => { if (!o) setShowAddItem(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Plan Item</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-[13px]">Item Type</Label>
              <Select
                value={addItemForm.targetType}
                onValueChange={(v) => setAddItemForm((f) => ({ ...f, targetType: v as AddItemFormData["targetType"], targetId: "" }))}
              >
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="course">Online training content</SelectItem>
                  <SelectItem value="training_type">Training Type (legacy)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {addItemForm.targetType === "course" ? (
              <div className="space-y-1.5">
                <Label className="text-[13px]">Training content *</Label>
                <Select value={addItemForm.targetId} onValueChange={(v) => setAddItemForm((f) => ({ ...f, targetId: v }))}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select training content" /></SelectTrigger>
                  <SelectContent>
                    {(courses ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.title}{c.status !== "published" ? ` (${c.status})` : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label className="text-[13px]">Training Type *</Label>
                <Select value={addItemForm.targetId} onValueChange={(v) => setAddItemForm((f) => ({ ...f, targetId: v }))}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select training type" /></SelectTrigger>
                  <SelectContent>
                    {(trainingTypes ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <label className="flex items-center gap-2.5 cursor-pointer">
              <Checkbox
                checked={addItemForm.isRequired}
                onCheckedChange={(checked) => setAddItemForm((f) => ({ ...f, isRequired: !!checked }))}
              />
              <span className="text-[13px]">Required</span>
            </label>
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
              This only removes the item from the plan template -- it does not affect any course
              assignments already created from a previous "Apply to Employee(s)" run.
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

export default function TrainingPlans() {
  const { user } = useAuth();
  const { toast } = useToast();

  // Matches RLS: platform_admin can maintain tenant training plans from the admin route,
  // while org_admin + trainer manage plans inside their own org. facility_manager remains read-only.
  // Creating a blank plan still requires an org context, so platform_admin uses the AI builder
  // (which asks for an owning organization) rather than this org-scoped quick-create form.
  const canCreatePlan = ["org_admin", "trainer"].includes(user?.role ?? "");
  const canManage = canCreatePlan || user?.role === "platform_admin";
  const canDeletePlan = user?.role === "org_admin" || user?.role === "platform_admin";

  const [search, setSearch] = useState("");
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [editingPlan, setEditingPlan] = useState<TrainingPlan | null>(null);
  const [planForm, setPlanForm] = useState<PlanFormData>(EMPTY_PLAN_FORM);
  const [deleteTarget, setDeleteTarget] = useState<TrainingPlan | null>(null);

  const { data: plans, isLoading } = useListTrainingPlans();
  const { mutate: createPlan, isPending: creatingPlan } = useCreateTrainingPlan();
  const { mutate: updatePlan, isPending: updatingPlan } = useUpdateTrainingPlan();
  const { mutate: deletePlan, isPending: deletingPlan } = useDeleteTrainingPlan();

  const allPlans = plans ?? [];
  const filtered = allPlans.filter((p) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return p.name.toLowerCase().includes(q) || (p.description ?? "").toLowerCase().includes(q);
  });

  const openCreate = () => {
    setEditingPlan(null);
    setPlanForm(EMPTY_PLAN_FORM);
    setShowPlanForm(true);
  };

  const openEdit = (e: React.MouseEvent, plan: TrainingPlan) => {
    e.stopPropagation();
    setEditingPlan(plan);
    setPlanForm({ name: plan.name, description: plan.description ?? "" });
    setShowPlanForm(true);
  };

  const handleSavePlan = () => {
    if (!planForm.name.trim()) {
      toast({ title: "Plan name is required", variant: "destructive" });
      return;
    }
    if (editingPlan) {
      updatePlan(
        { id: editingPlan.id, name: planForm.name.trim(), description: planForm.description || null },
        {
          onSuccess: () => { toast({ title: "Training plan updated" }); setShowPlanForm(false); setEditingPlan(null); },
          onError: (e: Error) => toast({ title: "Failed to update plan", description: e.message, variant: "destructive" }),
        },
      );
    } else if (user?.organizationId) {
      createPlan(
        {
          name: planForm.name.trim(),
          description: planForm.description || null,
          organization_id: user.organizationId,
          created_by: user.id,
        },
        {
          onSuccess: () => { toast({ title: "Training plan created" }); setShowPlanForm(false); setPlanForm(EMPTY_PLAN_FORM); },
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
          <h1>Training Plans</h1>
          <p>Bundle training content and training types into reusable curricula, then apply them to employees.</p>
        </div>
        {canCreatePlan && (
          <Button onClick={openCreate} className="shadow-sm">
            <Plus className="mr-2 h-4 w-4" /> New Plan
          </Button>
        )}
      </div>

      <div className="premium-card">
        <div className="filter-bar">
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

        {isLoading ? (
          <div className="p-6 space-y-3">
            {[...Array(4)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <ListChecks className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No training plans found</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              {search.trim() ? "Try adjusting your search" : canManage ? "Create your first plan to get started" : "Check back once a training plan has been created"}
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
                          <span className="font-medium text-foreground">{plan.name}</span>
                        </td>
                        <td className="text-muted-foreground max-w-md truncate">
                          {plan.description || "—"}
                        </td>
                        <td className="text-muted-foreground">
                          {new Date(plan.created_at).toLocaleDateString()}
                        </td>
                        <td>
                          <div className="flex items-center gap-0.5 justify-end">
                            {canManage && (
                              <Button
                                variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                onClick={(e) => openEdit(e, plan)}
                                aria-label={`Edit ${plan.name}`}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {canDeletePlan && (
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
                            <TrainingPlanItemsPanel plan={plan} canManage={canManage} />
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

      <Dialog open={showPlanForm} onOpenChange={(o) => { if (!o) { setShowPlanForm(false); setEditingPlan(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingPlan ? "Edit Training Plan" : "New Training Plan"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-[13px]">Name *</Label>
              <Input
                value={planForm.name}
                onChange={(e) => setPlanForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="New Hire Onboarding"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Description</Label>
              <Textarea
                value={planForm.description}
                onChange={(e) => setPlanForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="What this plan covers and who it's for"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowPlanForm(false); setEditingPlan(null); }}>Cancel</Button>
            <Button onClick={handleSavePlan} disabled={creatingPlan || updatingPlan} className="shadow-sm">
              {creatingPlan || updatingPlan ? "Saving..." : editingPlan ? "Save Changes" : "Create Plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Training Plan</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteTarget?.name}"? This removes the plan and all of
              its items. Training assignments already created from a previous "Apply" run are not affected.
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
