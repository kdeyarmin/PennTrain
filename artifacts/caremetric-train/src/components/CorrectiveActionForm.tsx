import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { useListEmployees } from "@/hooks/useEmployees";
import { useCreateCorrectiveAction, useUpdateCorrectiveAction, type CorrectiveAction } from "@/hooks/useCorrectiveActions";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { humanize } from "@/lib/utils";

// Full set of values the `corrective_actions.status` check constraint allows.
export const CORRECTIVE_ACTION_STATUSES = ["open", "in_progress", "completed", "overdue", "cancelled"] as const;
export type CorrectiveActionStatusValue = (typeof CORRECTIVE_ACTION_STATUSES)[number];

// "overdue" is computed by a scheduled recalculation (see the corrective_actions overdue sweep in
// incident_alerts_and_compliance.sql) whenever an open/in_progress action's due_date has passed --
// it isn't something a person should be able to assert by hand, so it's excluded from the editable
// Select even though the badge below still has to render it correctly when the job has set it.
const EDITABLE_STATUSES = CORRECTIVE_ACTION_STATUSES.filter((s) => s !== "overdue");

// Byte-identical badge previously duplicated in IncidentDetail.tsx and ViolationDetail.tsx --
// hoisted here next to the form that produces the status it renders.
export function CorrectiveActionStatusBadge({ status }: { status: string }) {
  const className =
    status === "completed" ? "bg-success text-success-foreground hover:bg-success/80"
    : status === "overdue" ? "bg-destructive text-destructive-foreground hover:bg-destructive/80"
    : status === "cancelled" ? "bg-muted text-muted-foreground"
    : "bg-info text-info-foreground hover:bg-info/80"; // open/in_progress
  return <Badge className={className} variant="outline">{humanize(status)}</Badge>;
}

const UNASSIGNED = "__unassigned__";

// Exactly one of these should be set, mirroring the corrective_actions_one_parent_check constraint.
export interface CorrectiveActionParent {
  organizationId: string;
  facilityId: string;
  violationId?: string;
  incidentId?: string;
  inspectionEventId?: string;
}

interface CorrectiveActionFormProps {
  parent: CorrectiveActionParent;
  /** Pass the action being edited to switch into edit mode (Save/Cancel, status becomes editable). Omit for create mode (a single "+" button, status left at the server's "open" default). */
  editing?: CorrectiveAction | null;
  /** Called after a successful create or save. */
  onDone?: () => void;
  /** Edit mode only -- called when the user cancels out of editing. */
  onCancelEdit?: () => void;
  /** "sm" matches the compact nested layout InspectionItemDetail.tsx uses under each inspection event. */
  size?: "sm" | "default";
}

// Shared create/edit UI for the corrective_actions table -- used identically from
// ViolationDetail.tsx, IncidentDetail.tsx, and InspectionItemDetail.tsx so a corrective action
// filed from any of the three can be handed to a responsible staff member the same way.
export function CorrectiveActionForm({ parent, editing, onDone, onCancelEdit, size = "default" }: CorrectiveActionFormProps) {
  const { toast } = useToast();
  // Scoped to this action's facility -- an org can have far more employees than makes sense in one
  // dropdown, and every field involving a corrective action (violation, incident, inspection event)
  // already carries a single facility_id.
  const { user } = useAuth();
  const { data: employees } = useListEmployees({ facilityId: parent.facilityId });
  const { mutate: createAction, isPending: creating } = useCreateCorrectiveAction();
  const { mutate: updateAction, isPending: savingEdit } = useUpdateCorrectiveAction();

  const [description, setDescription] = useState(editing?.description ?? "");
  const [dueDate, setDueDate] = useState(editing?.due_date ?? "");
  const [assigneeEmployeeId, setAssigneeEmployeeId] = useState("");
  const [status, setStatus] = useState<CorrectiveActionStatusValue>((editing?.status as CorrectiveActionStatusValue) ?? "open");

  // editing.owner_profile_id is a profile id (what's persisted); the Select below is keyed on
  // employee id (what every other assignee picker in the app uses) -- resolve one to the other
  // once this facility's employees have loaded, since `employees` is still undefined on first render.
  useEffect(() => {
    if (!editing?.owner_profile_id || !employees) return;
    const match = employees.find((e) => e.profile_id === editing.owner_profile_id);
    if (match) setAssigneeEmployeeId(match.id);
  }, [editing?.owner_profile_id, employees]);

  // Create mode only: default the assignee to whoever's filing this, matching the pre-unification
  // behavior on IncidentDetail.tsx/InspectionItemDetail.tsx (owner_profile_id: user?.id ?? null on
  // create) -- the reporter can still clear it to "Unassigned" or hand it to someone else.
  useEffect(() => {
    if (editing || !user || !employees || assigneeEmployeeId) return;
    const self = employees.find((e) => e.profile_id === user.id);
    if (self) setAssigneeEmployeeId(self.id);
  }, [editing, user, employees, assigneeEmployeeId]);

  const isEdit = !!editing;
  const submitting = creating || savingEdit;
  const inputCls = size === "sm" ? "h-7 text-xs" : "h-9";
  const iconCls = size === "sm" ? "h-3 w-3" : "h-4 w-4";
  const buttonCls = size === "sm" ? "h-7 px-2" : "";

  const resetForCreate = () => {
    setDescription("");
    setDueDate("");
    setAssigneeEmployeeId("");
    setStatus("open");
  };

  const handleSubmit = () => {
    if (!description.trim() || !dueDate) {
      toast({ title: "Description and due date are required", variant: "destructive" });
      return;
    }
    const employee = employees?.find((e) => e.id === assigneeEmployeeId);
    const ownerProfileId = employee?.profile_id ?? null;
    const ownerName = employee ? `${employee.last_name}, ${employee.first_name}` : null;

    if (editing) {
      // Mirrors the dedicated "mark complete" check-button elsewhere on these pages: moving status
      // to "completed" stamps today's date unless it was already completed (in which case its
      // original completion date is kept); moving off "completed" clears it.
      const completedDate =
        status === "completed" ? (editing.status === "completed" ? editing.completed_date : new Date().toISOString().slice(0, 10))
        : null;
      updateAction(
        {
          id: editing.id, description: description.trim(), due_date: dueDate,
          owner_profile_id: ownerProfileId, owner_name: ownerName, status, completed_date: completedDate,
        },
        {
          onSuccess: () => onDone?.(),
          onError: (err: Error) => toast({ title: "Failed to update corrective action", description: err.message, variant: "destructive" }),
        },
      );
      return;
    }

    createAction(
      {
        description: description.trim(), due_date: dueDate,
        owner_profile_id: ownerProfileId, owner_name: ownerName,
        organization_id: parent.organizationId, facility_id: parent.facilityId,
        violation_id: parent.violationId ?? null,
        incident_id: parent.incidentId ?? null,
        inspection_event_id: parent.inspectionEventId ?? null,
      },
      {
        onSuccess: () => { resetForCreate(); onDone?.(); },
        onError: (err: Error) => toast({ title: "Failed to add corrective action", description: err.message, variant: "destructive" }),
      },
    );
  };

  return (
    <div className={size === "sm" ? "flex items-center gap-1.5 flex-wrap" : "flex items-center gap-2 flex-wrap"}>
      <Input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Corrective action description"
        className={`${inputCls} flex-1 min-w-[160px]`}
      />
      <Select value={assigneeEmployeeId || UNASSIGNED} onValueChange={(v) => setAssigneeEmployeeId(v === UNASSIGNED ? "" : v)}>
        <SelectTrigger className={`${inputCls} ${size === "sm" ? "w-32" : "w-44"} shrink-0`}>
          <SelectValue placeholder="Assigned to (optional)" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
          {employees?.map((e) => <SelectItem key={e.id} value={e.id}>{e.last_name}, {e.first_name}</SelectItem>)}
        </SelectContent>
      </Select>
      {isEdit && (
        <Select value={status} onValueChange={(v) => setStatus(v as CorrectiveActionStatusValue)}>
          <SelectTrigger className={`${inputCls} ${size === "sm" ? "w-28" : "w-36"} shrink-0`}><SelectValue /></SelectTrigger>
          <SelectContent>
            {EDITABLE_STATUSES.map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
            {/* If the recalc job has already flagged this one overdue, keep it selectable so the
                current value always has a matching option -- just not chooseable for any other row. */}
            {status === "overdue" && <SelectItem value="overdue">{humanize("overdue")}</SelectItem>}
          </SelectContent>
        </Select>
      )}
      <Input
        type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
        className={`${inputCls} ${size === "sm" ? "w-32" : "w-40"} shrink-0`}
      />
      <Button size="sm" className={buttonCls} disabled={submitting} onClick={handleSubmit}>
        {isEdit ? (submitting ? "Saving..." : "Save") : submitting ? "Saving..." : <Plus className={iconCls} />}
      </Button>
      {isEdit && (
        <Button size="sm" variant="ghost" className={buttonCls} onClick={onCancelEdit} disabled={submitting}>
          Cancel
        </Button>
      )}
    </div>
  );
}
