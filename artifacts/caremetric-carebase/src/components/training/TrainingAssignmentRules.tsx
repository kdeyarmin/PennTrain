import { useId, useState } from "react";
import { useApplyTrainingAssignmentRule, useApproveTrainingAssignmentAutomation, usePreviewTrainingAssignmentRule, useSaveTrainingAssignmentRule, useTrainingAssignmentRule, type AssignmentRule } from "@/hooks/useTrainingStarterKits";
import type { TrainingPlan } from "@/hooks/useTrainingPlans";
import { useListEmployees } from "@/hooks/useEmployees";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QueryError } from "@/components/QueryState";
import { formatDateForDisplay } from "@/lib/dateUtils";
import { useToast } from "@/hooks/use-toast";

export function TrainingAssignmentRules({ plan }: { plan: TrainingPlan }) {
  const rule = useTrainingAssignmentRule(plan.id);
  return <details className="border rounded-lg p-3 space-y-3"><summary className="font-medium cursor-pointer">Role and department assignment rules</summary>
    {rule.isError ? <QueryError what="assignment rule" error={rule.error} onRetry={() => void rule.refetch()} /> : rule.isLoading ? <p>Loading assignment rule…</p> : <RuleEditor key={rule.data?.revision ?? "new"} plan={plan} rule={rule.data ?? null} />}
  </details>;
}
function RuleEditor({ plan, rule }: { plan: TrainingPlan; rule: AssignmentRule | null }) {
  const field = useId(), { toast } = useToast();
  const [jobTitle, setJobTitle] = useState(rule?.job_title ?? ""), [department, setDepartment] = useState(rule?.department ?? "");
  const [enabled, setEnabled] = useState(rule?.is_enabled ?? true);
  const [selected, setSelected] = useState<string[]>([]);
  const [approveAutomatic, setApproveAutomatic] = useState(false);
  const staff = useListEmployees({ facilityId: plan.facility_id!, organizationId: plan.organization_id, status: "active" });
  const save = useSaveTrainingAssignmentRule(), preview = usePreviewTrainingAssignmentRule(), apply = useApplyTrainingAssignmentRule(), automation = useApproveTrainingAssignmentAutomation();
  const dirty = !rule || jobTitle.trim() !== (rule.job_title ?? "") || department.trim() !== (rule.department ?? "") || enabled !== rule.is_enabled;
  const busy = save.isPending || preview.isPending || apply.isPending || automation.isPending;
  const result = preview.data;
  const pending = result?.employees.filter(e => !e.already_enrolled) ?? [];
  const currentAutomatic = rule?.automatic_enabled && result && rule.approved_snapshot === result.automatic_fingerprint && result.can_apply;
  async function refresh() {
    setSelected([]); setApproveAutomatic(false); apply.reset(); automation.reset();
    try { await preview.mutateAsync(plan.id); } catch { /* Error is shown below. */ }
  }
  return <div className="space-y-3 pt-3">
    <p className="text-sm text-muted-foreground">Match exact job titles or departments, ignoring capitalization. Enter both to require both matches. Preview and select employees before applying. Dates always come from this saved plan; existing plan enrollments and individual assignment dates stay unchanged.</p>
    <form className="space-y-3" onSubmit={async e => { e.preventDefault(); try {
      await save.mutateAsync({ planId: plan.id, jobTitle, department, enabled, revision: rule?.revision });
      toast({ title: "Assignment rule saved", description: "Preview matching staff to apply the plan. Any previous automatic approval has been cleared." });
    } catch { /* Error is shown below. */ } }}><fieldset disabled={busy} className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3"><label className="block text-sm">Job title / staff role<Input maxLength={160} list={`${field}-titles`} value={jobTitle} onChange={e => { setJobTitle(e.target.value); preview.reset(); }} placeholder="For example, Caregiver" /></label>
        <label className="block text-sm">Department<Input maxLength={160} list={`${field}-departments`} value={department} onChange={e => { setDepartment(e.target.value); preview.reset(); }} placeholder="For example, Dietary" /></label></div>
      <datalist id={`${field}-titles`}>{[...new Set(staff.data?.map(e => e.job_title).filter(Boolean) ?? [])].map(value => <option key={value} value={value} />)}</datalist>
      <datalist id={`${field}-departments`}>{[...new Set(staff.data?.map(e => e.department).filter((v): v is string => !!v) ?? [])].map(value => <option key={value} value={value} />)}</datalist>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={e => { setEnabled(e.target.checked); preview.reset(); }} />Rule enabled</label>
      <div className="flex gap-2 flex-wrap"><Button size="sm" disabled={(!jobTitle.trim() && !department.trim()) || !dirty}>{save.isPending ? "Saving…" : "Save matching rule"}</Button>
        <Button type="button" size="sm" variant="outline" disabled={!rule || dirty} onClick={() => void refresh()}>{preview.isPending ? "Preparing preview…" : "Preview matching staff"}</Button>
        {rule?.automatic_enabled && <Button type="button" size="sm" variant="outline" onClick={() => automation.mutate({ planId: plan.id, fingerprint: "", enabled: false }, { onSuccess: () => toast({ title: "Automatic assignments disabled" }) })}>Disable automatic assignments</Button>}
      </div>
      {dirty && rule && <p className="text-xs">Save these changes before previewing or applying.</p>}
    </fieldset></form>
    {rule?.automatic_enabled && !result && <p className="text-sm">Automatic mode was approved. Preview to check whether the saved courses and deadline are still current.</p>}
    {result && !dirty && <section aria-label="Role rule assignment preview" className="rounded border p-3 space-y-3">
      <h4 className="font-semibold">Review matching staff</h4>
      <p className="text-sm">{pending.length} pending matches · {result.employees.length - pending.length} already enrolled · Due {formatDateForDisplay(result.due_date)}</p>
      <ul className="list-disc pl-5 text-sm">{result.courses.map(c => <li key={c.course_id}>{c.title} — {c.is_required ? "Required" : "Optional"}{!c.available && " · Unavailable; review this plan"}</li>)}</ul>
      {!result.can_apply && <p role="alert" className="text-sm">This rule is disabled, its deadline is past, or its courses need review. Update the plan and rule, then refresh this preview.</p>}
      <label className="flex gap-2 text-sm"><input type="checkbox" disabled={busy || !result.can_apply || !pending.length} checked={pending.length > 0 && pending.slice(0, 100).every(e => selected.includes(e.id))} onChange={e => setSelected(e.target.checked ? pending.slice(0, 100).map(e => e.id) : [])} />Select up to 100 pending matches</label>
      <div className="max-h-72 overflow-y-auto space-y-2">{result.employees.map(employee => <div className="border rounded p-2" key={employee.id}><label className="flex gap-2 text-sm">
        <input type="checkbox" checked={selected.includes(employee.id)} disabled={busy || !result.can_apply || employee.already_enrolled || (selected.length >= 100 && !selected.includes(employee.id))} onChange={e => setSelected(ids => e.target.checked ? [...ids, employee.id] : ids.filter(id => id !== employee.id))} />
        <span>{employee.first_name} {employee.last_name}<span className="block text-xs text-muted-foreground">{employee.job_title}{employee.department ? ` · ${employee.department}` : ""}{employee.already_enrolled ? " · Already enrolled; use Apply Plan to review changes" : " · Pending assignment"}</span></span>
      </label>{employee.existing_assignments.length > 0 && <ul className="ml-6 text-xs text-muted-foreground">{employee.existing_assignments.map(a => <li key={a.id}>{result.courses.find(c => c.course_id === a.course_id)?.title}: {a.status.replaceAll("_", " ")}{a.due_date ? ` · Existing due date ${formatDateForDisplay(a.due_date)}` : ""}</li>)}</ul>}</div>)}</div>
      {!result.employees.length && <p className="text-sm">No active staff match this rule yet.</p>}
      <Button size="sm" disabled={busy || !result.can_apply || !selected.length} onClick={async () => { try {
        const applied = await apply.mutateAsync({ planId: plan.id, fingerprint: result.fingerprint, employeeIds: selected });
        toast({ title: `${applied.reduce((total, row) => total + row.result.assigned, 0)} assignments created`, description: "Review any existing-assignment conflicts below. Dates on individual assignments were preserved." });
        setSelected([]); setApproveAutomatic(false); await preview.mutateAsync(plan.id);
      } catch { /* Stale previews are visible and must be refreshed. */ } }}>{apply.isPending ? "Applying…" : `Confirm plan for ${selected.length} employees`}</Button>
      {apply.data?.some(row => row.result.conflicts?.length) && <div role="status" className="text-sm"><p>Existing assignments need review in plan progress:</p><ul className="list-disc pl-5">{apply.data.flatMap(row => (row.result.conflicts ?? []).map((conflict, index) => <li key={`${row.employee_id}-${index}`}>{result.employees.find(e => e.id === row.employee_id)?.first_name} {result.employees.find(e => e.id === row.employee_id)?.last_name}: {conflict.title} — existing deadline {formatDateForDisplay(conflict.due_date)} preserved.</li>))}</ul></div>}
      <div className="border-t pt-3 space-y-2">
        <p className="font-medium text-sm">Optional automatic assignments</p>
        <p className="text-xs text-muted-foreground">After approval, an authorized manager’s staff creation or role/department change can apply this exact plan to new matching staff. Changed courses, changed dates, past deadlines, imports without a current authorized manager, or blocked assignments stay pending for review. Automatic mode never reapplies an existing enrollment.</p>
        {currentAutomatic ? <p role="status" className="text-sm">Automatic mode is approved for these courses and this exact deadline.</p> : <>
          {rule?.automatic_enabled && <p role="status" className="text-sm">Automatic approval is out of date. Review this plan and approve it again.</p>}
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={approveAutomatic} disabled={busy || !result.can_apply} onChange={e => setApproveAutomatic(e.target.checked)} />I approve these courses and the {formatDateForDisplay(result.due_date)} deadline for future matching staff changes.</label>
          <Button variant="outline" size="sm" disabled={busy || !result.can_apply || !approveAutomatic} onClick={() => automation.mutate({ planId: plan.id, fingerprint: result.fingerprint, enabled: true }, { onSuccess: () => toast({ title: "Automatic assignments approved", description: "The exact saved plan and deadline will apply to future matching staff changes." }) })}>Enable approved automatic assignments</Button>
        </>}
      </div>
    </section>}
    {[save.error, preview.error, apply.error, automation.error].filter(Boolean).map((error, index) => <p key={index} role="alert" className="text-sm text-destructive">{error!.message}</p>)}
  </div>;
}
