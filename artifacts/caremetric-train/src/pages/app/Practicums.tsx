import { useMemo, useState } from "react";
import { useListPracticums, useCreatePracticum, useUpdatePracticum, type Practicum, type PracticumInsert } from "@/hooks/usePracticums";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListEmployees } from "@/hooks/useEmployees";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { useAuth, type Role } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { FileCheck, Plus, CheckCircle, XCircle, Pencil } from "lucide-react";

// Matches practicums_insert/practicums_update RLS (supabase/migrations/
// 20260704053527_group_b_rls_policies.sql): org_admin/facility_manager/trainer, each additionally
// gated server-side by is_assigned_to_facility(facility_id). platform_admin isn't named in the
// policy but is_platform_admin() short-circuits every practicums policy, so it's added here too.
// auditor can reach this page (it's in ORG_ROLES, see App.tsx) but has no write grant there, so
// its create/edit controls must be hidden rather than rendered and left to fail at the database.
const PRACTICUM_MANAGE_ROLES: Role[] = ["platform_admin", "org_admin", "facility_manager", "trainer"];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Mirrors the practicums branch of recalculate_all_compliance() (supabase/migrations/
// 20260704053624_compliance_rpcs_and_audit_trigger.sql, carried unchanged through every later
// compliance migration up to 20260705040300_inspection_evidence_and_alerts.sql):
//   update public.practicums p set status = case
//     when p.due_date is null then 'missing'
//     when p.due_date < current_date then 'expired'
//     when p.due_date <= current_date + p.reminder_days then 'due_soon'
//     else 'compliant' end;
// Unlike employee_training_records, practicums has no renewal-interval column/formula, so
// due_date is never derived from completion_date server-side -- it's purely an admin-entered
// value, and status is purely a function of that due_date plus the row's own reminder_days
// window (completion_date/mar_review/direct_observation don't factor into status at all). The
// nightly recalc job will recompute this the same way; this client copy only gives immediate
// feedback in the dialog before that job next runs.
function computePracticumStatus(dueDate: string | null, reminderDays: number): string {
  if (!dueDate) return "missing";
  const today = todayISO();
  if (dueDate < today) return "expired";
  if (dueDate <= addDaysISO(today, reminderDays)) return "due_soon";
  return "compliant";
}

interface PracticumFormState {
  employeeId: string;
  practicumYear: string;
  completionDate: string;
  dueDate: string;
  reminderDays: string;
  observedBy: string;
  window1ObservationDate: string;
  window1ObservationBy: string;
  window1MarReviewDate: string;
  window1MarReviewBy: string;
  window2ObservationDate: string;
  window2ObservationBy: string;
  window2MarReviewDate: string;
  window2MarReviewBy: string;
  remediationRequired: boolean;
  remediationNotes: string;
  notes: string;
}

function emptyPracticumForm(defaultYear: number): PracticumFormState {
  return {
    employeeId: "",
    practicumYear: String(defaultYear),
    completionDate: "",
    dueDate: "",
    reminderDays: "30",
    observedBy: "",
    window1ObservationDate: "",
    window1ObservationBy: "",
    window1MarReviewDate: "",
    window1MarReviewBy: "",
    window2ObservationDate: "",
    window2ObservationBy: "",
    window2MarReviewDate: "",
    window2MarReviewBy: "",
    remediationRequired: false,
    remediationNotes: "",
    notes: "",
  };
}

function practicumToForm(p: Practicum): PracticumFormState {
  return {
    employeeId: p.employee_id,
    practicumYear: String(p.practicum_year),
    completionDate: p.completion_date ?? "",
    dueDate: p.due_date ?? "",
    reminderDays: String(p.reminder_days),
    observedBy: p.observed_by ?? "",
    window1ObservationDate: p.window1_observation_date ?? "",
    window1ObservationBy: p.window1_observation_by ?? "",
    window1MarReviewDate: p.window1_mar_review_date ?? "",
    window1MarReviewBy: p.window1_mar_review_by ?? "",
    window2ObservationDate: p.window2_observation_date ?? "",
    window2ObservationBy: p.window2_observation_by ?? "",
    window2MarReviewDate: p.window2_mar_review_date ?? "",
    window2MarReviewBy: p.window2_mar_review_by ?? "",
    remediationRequired: p.remediation_required,
    remediationNotes: p.remediation_notes ?? "",
    notes: p.notes ?? "",
  };
}

export default function Practicums() {
  const [facilityId, setFacilityId] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const currentYear = new Date().getFullYear();

  const { user } = useAuth();
  const { toast } = useToast();
  const canManage = !!user && PRACTICUM_MANAGE_ROLES.includes(user.role);

  const { data: practicums, isLoading } = useListPracticums({
    facilityId: facilityId && facilityId !== "all" ? facilityId : undefined,
    year: currentYear,
    status: status && status !== "all" ? status : undefined,
  });

  const { data: facilities } = useListFacilities();
  const { data: employeesAll } = useListEmployees();
  // Practicums track annual medication-administration competency, so only staff who administer
  // medications are relevant here -- mirrors this page's pre-existing employee filter.
  const employees = useMemo(() => employeesAll?.filter(e => e.administers_medications), [employeesAll]);
  const employeeMap = useMemo(() => new Map((employeesAll ?? []).map(e => [e.id, e])), [employeesAll]);
  // "Qualified observer" roster for the window observer pickers: a designated trainer, or someone
  // already administering medications themselves (able to verify a peer's technique/MAR review).
  const qualifiedObservers = useMemo(
    () => (employeesAll ?? []).filter(e => e.trainer_status || e.administers_medications),
    [employeesAll],
  );
  const facilityNameById = useMemo(() => new Map((facilities ?? []).map(f => [f.id, f.name])), [facilities]);

  const getEmployee = (id: string) => employeeMap.get(id);

  const createPracticum = useCreatePracticum();
  const updatePracticum = useUpdatePracticum();
  const busy = createPracticum.isPending || updatePracticum.isPending;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPracticum, setEditingPracticum] = useState<Practicum | null>(null);
  const [form, setForm] = useState<PracticumFormState>(() => emptyPracticumForm(currentYear));

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingPracticum(null);
  };

  const openCreateDialog = () => {
    setEditingPracticum(null);
    setForm(emptyPracticumForm(currentYear));
    setDialogOpen(true);
  };

  const openEditDialog = (p: Practicum) => {
    if (!canManage) return;
    setEditingPracticum(p);
    setForm(practicumToForm(p));
    setDialogOpen(true);
  };

  const reminderDaysPreview = Number(form.reminderDays);
  const previewStatus = computePracticumStatus(
    form.dueDate || null,
    Number.isFinite(reminderDaysPreview) ? reminderDaysPreview : 30,
  );

  const handleSave = async () => {
    const yearNum = Number(form.practicumYear);
    if (!form.practicumYear.trim() || !Number.isInteger(yearNum)) {
      toast({ title: "Enter a valid practicum year", variant: "destructive" });
      return;
    }
    const reminderDaysNum = form.reminderDays.trim() ? Number(form.reminderDays) : 30;
    if (!Number.isFinite(reminderDaysNum) || reminderDaysNum < 0) {
      toast({ title: "Reminder window must be a non-negative number of days", variant: "destructive" });
      return;
    }

    // Editing an existing row: reuse its own organization_id/facility_id/employee_id rather than
    // re-resolving through the (administers_medications-filtered) employees list, since an
    // existing practicum's employee could in principle have since fallen out of that filter.
    // Creating: resolve scope from the employee picked in the dialog. Either way, the
    // stamp_scope_from_employee trigger (supabase/migrations/20260704180646 and 20260704182232)
    // re-derives organization_id/facility_id from employee_id server-side on insert and update,
    // so this is just satisfying the not-null columns/RLS with-check with correct values, not
    // the sole source of truth.
    let organizationId: string;
    let facilityIdForRow: string;
    let employeeId: string;
    if (editingPracticum) {
      organizationId = editingPracticum.organization_id;
      facilityIdForRow = editingPracticum.facility_id;
      employeeId = editingPracticum.employee_id;
    } else {
      const employee = employeeMap.get(form.employeeId);
      if (!employee) {
        toast({ title: "Select an employee", variant: "destructive" });
        return;
      }
      organizationId = employee.organization_id;
      facilityIdForRow = employee.facility_id;
      employeeId = employee.id;
    }

    const dueDate = form.dueDate || null;
    const payload: PracticumInsert = {
      organization_id: organizationId,
      facility_id: facilityIdForRow,
      employee_id: employeeId,
      practicum_year: yearNum,
      completion_date: form.completionDate || null,
      due_date: dueDate,
      reminder_days: reminderDaysNum,
      status: computePracticumStatus(dueDate, reminderDaysNum),
      // mar_review_completed/direct_observation_completed are NOT sent -- the
      // derive_practicum_completion_flags trigger (supabase/migrations/
      // 20260705143706_med_admin_practicum_windows_and_diabetes_education.sql) derives them
      // from the window columns below, so they can never drift out of sync with the dates.
      observed_by: form.observedBy.trim() || null,
      window1_observation_date: form.window1ObservationDate || null,
      window1_observation_by: form.window1ObservationBy || null,
      window1_mar_review_date: form.window1MarReviewDate || null,
      window1_mar_review_by: form.window1MarReviewBy || null,
      window2_observation_date: form.window2ObservationDate || null,
      window2_observation_by: form.window2ObservationBy || null,
      window2_mar_review_date: form.window2MarReviewDate || null,
      window2_mar_review_by: form.window2MarReviewBy || null,
      remediation_required: form.remediationRequired,
      remediation_notes: form.remediationRequired ? (form.remediationNotes.trim() || null) : null,
      notes: form.notes.trim() || null,
    };

    try {
      if (editingPracticum) {
        await updatePracticum.mutateAsync({ id: editingPracticum.id, ...payload });
        toast({ title: "Practicum updated" });
      } else {
        await createPracticum.mutateAsync(payload);
        toast({ title: "Practicum recorded" });
      }
      closeDialog();
    } catch (err) {
      toast({
        title: "Failed to save practicum",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Annual Practicums</h1>
          <p className="text-muted-foreground">Track {currentYear} annual medication administration practicums.</p>
        </div>
        {canManage && (
          <Button onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" /> Record Practicum
          </Button>
        )}
      </div>

      <div className="flex gap-3">
        <Select value={facilityId} onValueChange={setFacilityId}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="All Facilities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Facilities</SelectItem>
            {facilities?.map(f => (
              <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="compliant">Compliant</SelectItem>
            <SelectItem value="due_soon">Due Soon</SelectItem>
            <SelectItem value="missing">Missing</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{currentYear} Practicum Status</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-md" />)}
            </div>
          ) : (
            <div className="space-y-2">
              {practicums?.map(p => {
                const emp = getEmployee(p.employee_id);
                return (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${canManage ? "cursor-pointer hover:bg-accent/5" : ""}`}
                    onClick={canManage ? () => openEditDialog(p) : undefined}
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
                        <FileCheck className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">
                          {emp ? `${emp.first_name} ${emp.last_name}` : `Employee #${p.employee_id}`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {p.completion_date ? `Completed: ${new Date(p.completion_date).toLocaleDateString()}` : `Due: ${p.due_date ? new Date(p.due_date).toLocaleDateString() : "N/A"}`}
                          {p.observed_by && ` · Observed by: ${p.observed_by}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <span title="MAR Review">{p.mar_review_completed ? <CheckCircle className="h-3.5 w-3.5 text-green-500" /> : <XCircle className="h-3.5 w-3.5 text-gray-300" />}</span>
                        <span>MAR</span>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <span title="Direct Observation">{p.direct_observation_completed ? <CheckCircle className="h-3.5 w-3.5 text-green-500" /> : <XCircle className="h-3.5 w-3.5 text-gray-300" />}</span>
                        <span>Obs</span>
                      </div>
                      <StatusBadge status={p.status} />
                      {canManage && <Pencil className="h-3.5 w-3.5 text-muted-foreground/60" />}
                    </div>
                  </div>
                );
              })}
              {(!practicums || practicums.length === 0) && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                    <CheckCircle className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="font-medium text-muted-foreground">No practicum records found</p>
                  <p className="text-sm text-muted-foreground/60 mt-1">Practicum records will appear here once scheduled.</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={open => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingPracticum ? "Edit Practicum" : "Record Practicum"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {editingPracticum ? (
              <div className="text-sm text-muted-foreground">
                {(() => {
                  const emp = employeeMap.get(editingPracticum.employee_id);
                  return emp ? `${emp.first_name} ${emp.last_name}` : `Employee #${editingPracticum.employee_id}`;
                })()}
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label className="text-[13px]">Employee *</Label>
                <Select value={form.employeeId} onValueChange={v => setForm(f => ({ ...f, employeeId: v }))}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>
                    {employees?.map(e => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.first_name} {e.last_name}{facilityNameById.get(e.facility_id) ? ` — ${facilityNameById.get(e.facility_id)}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[13px]">Practicum Year *</Label>
                <Input
                  type="number" min="2000" max="2100" className="h-9"
                  value={form.practicumYear}
                  onChange={e => setForm(f => ({ ...f, practicumYear: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Reminder Window (days)</Label>
                <Input
                  type="number" min="0" className="h-9"
                  value={form.reminderDays}
                  onChange={e => setForm(f => ({ ...f, reminderDays: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Completion Date</Label>
                <Input
                  type="date" className="h-9"
                  value={form.completionDate}
                  onChange={e => setForm(f => ({ ...f, completionDate: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Due Date</Label>
                <Input
                  type="date" className="h-9"
                  value={form.dueDate}
                  onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label className="text-[13px]">Observed By</Label>
                <Input
                  className="h-9" placeholder="Name of observer (optional)"
                  value={form.observedBy}
                  onChange={e => setForm(f => ({ ...f, observedBy: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-[13px] font-medium">
                Practicum Windows <span className="font-normal text-muted-foreground">(2 observations + 2 MAR reviews/year, one per 6-month window)</span>
              </p>
              {([
                { label: "Window 1 (Jan – Jun)", obsDate: "window1ObservationDate" as const, obsBy: "window1ObservationBy" as const, marDate: "window1MarReviewDate" as const, marBy: "window1MarReviewBy" as const },
                { label: "Window 2 (Jul – Dec)", obsDate: "window2ObservationDate" as const, obsBy: "window2ObservationBy" as const, marDate: "window2MarReviewDate" as const, marBy: "window2MarReviewBy" as const },
              ]).map(w => (
                <div key={w.label} className="rounded-lg border p-3 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">{w.label}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Direct Observation Date</Label>
                      <Input
                        type="date" className="h-8 text-sm"
                        value={form[w.obsDate]}
                        onChange={e => setForm(f => ({ ...f, [w.obsDate]: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Observed By</Label>
                      <Select value={form[w.obsBy] || "none"} onValueChange={v => setForm(f => ({ ...f, [w.obsBy]: v === "none" ? "" : v }))}>
                        <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select observer" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          {qualifiedObservers.map(o => (
                            <SelectItem key={o.id} value={o.id}>{o.first_name} {o.last_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">MAR Review Date</Label>
                      <Input
                        type="date" className="h-8 text-sm"
                        value={form[w.marDate]}
                        onChange={e => setForm(f => ({ ...f, [w.marDate]: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Reviewed By</Label>
                      <Select value={form[w.marBy] || "none"} onValueChange={v => setForm(f => ({ ...f, [w.marBy]: v === "none" ? "" : v }))}>
                        <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select reviewer" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          {qualifiedObservers.map(o => (
                            <SelectItem key={o.id} value={o.id}>{o.first_name} {o.last_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={form.remediationRequired}
                  onCheckedChange={checked => setForm(f => ({ ...f, remediationRequired: !!checked }))}
                />
                Remediation Required
              </label>
            </div>

            {form.remediationRequired && (
              <div className="space-y-1.5">
                <Label className="text-[13px]">Remediation Notes</Label>
                <Textarea
                  rows={2}
                  value={form.remediationNotes}
                  onChange={e => setForm(f => ({ ...f, remediationNotes: e.target.value }))}
                  placeholder="What remediation is required..."
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-[13px]">Notes</Label>
              <Textarea
                rows={2}
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Optional notes..."
              />
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Status will be computed as:</span>
              <StatusBadge status={previewStatus} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button onClick={handleSave} disabled={busy}>
              {busy ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
