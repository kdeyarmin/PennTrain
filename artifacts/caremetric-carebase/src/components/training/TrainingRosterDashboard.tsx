import { TrainingAssignmentExemption } from "./TrainingAssignmentExemption";
import { useDeferredValue, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useTrainingRosterProgress, type TrainingRosterRow } from "@/hooks/useTrainingProgress";
import { useInviteUser } from "@/hooks/useProfiles";
import { useResendInvitation } from "@/hooks/useInvitationLifecycle";
import { useAuth } from "@/lib/auth";
import { absoluteAppUrl } from "@/lib/appUrl";
import { formatDateForDisplay } from "@/lib/dateUtils";
import { useToast } from "@/hooks/use-toast";
import { QueryError } from "@/components/QueryState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const accountLabels: Record<string, string> = { activated: "Activated", accepted: "Activated", needs_email: "Needs email / classroom learner",
  not_invited: "Ready to invite", linked: "Account linked; activation not recorded", sent: "Invitation sent", pending: "Invitation pending",
  expired: "Invitation expired", failed: "Invitation failed", delivery_failed: "Delivery failed", revoked: "Invitation revoked" };
export default function TrainingRosterDashboard({ facilityId, organizationId, onEmployee, onTab }: {
  facilityId: string; organizationId: string; onEmployee: (id: string) => void; onTab: (tab: string) => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [state, setState] = useState("all");
  const [year, setYear] = useState("");
  const [offset, setOffset] = useState(0);
  const validYear = !year || (Number.isInteger(Number(year)) && Number(year) >= 1990 && Number(year) <= 2200);
  const report = useTrainingRosterProgress(facilityId, { search: useDeferredValue(search), state, year: year ? Number(year) : undefined, offset });
  const invite = useInviteUser();
  const resend = useResendInvitation();
  const canInvite = ["org_admin", "facility_manager", "platform_admin"].includes(user?.role || "");
  const busy = invite.isPending || resend.isPending;
  const changeState = (value: string) => { setState(value); setOffset(0); };
  async function send(row: TrainingRosterRow) {
    try {
      if (row.invitation_id) await resend.mutateAsync(row.invitation_id);
      else await invite.mutateAsync({ email: row.email!, firstName: row.first_name, lastName: row.last_name,
        role: "employee", organizationId, employeeId: row.employee_id, redirectTo: absoluteAppUrl("/reset-password") });
      await client.invalidateQueries({ queryKey: ["course_assignments", "training-roster"] });
      toast({ title: `Invitation sent to ${row.student}` });
    } catch (error) { toast({ title: "Invitation was not sent", description: error instanceof Error ? error.message : "Review invitation status and retry.", variant: "destructive" }); }
  }
  const counts = report.data;
  return <section className="space-y-4" aria-label="Staff training progress">
    <div><h2 className="text-xl font-semibold">Staff training progress</h2><p className="text-sm text-muted-foreground">Every active employee is included, even before training is assigned. Optional learning does not reduce required completion.</p></div>
    <div className="flex flex-wrap gap-3">
      <label className="text-sm">Find employee<Input value={search} onChange={e => { setSearch(e.target.value); setOffset(0); }} placeholder="Name or email" maxLength={200} /></label>
      <label className="text-sm">Training year<Input type="number" min={1990} max={2200} value={year} placeholder="All years" onChange={e => { setYear(e.target.value); setOffset(0); }} /></label>
      <Button variant="outline" disabled={!validYear} onClick={() => void report.refetch()}>Refresh staff progress</Button>
    </div>
    {!validYear ? <p role="alert">Enter a year from 1990 to 2200, or clear the field for all years.</p> : report.isError ? <QueryError what="staff progress" error={report.error} onRetry={() => void report.refetch()} /> : report.isLoading ? <p role="status">Loading staff progress…</p> : counts && <>
      <details className="rounded-lg border p-4" open={!counts.setup.profile_complete || !counts.setup.has_policy || !counts.setup.staff_count || counts.setup.assigned_staff < counts.setup.staff_count}>
        <summary className="cursor-pointer font-semibold">Get your facility started</summary>
        <ol className="list-decimal pl-5 space-y-2 mt-3 text-sm">
          <li>{counts.setup.profile_complete ? "✓" : "To do:"} <Link className="underline" href={`/app/facilities/${facilityId}?source=train`}>Confirm facility address, license, phone and administrator</Link></li>
          <li>{counts.setup.has_policy ? "✓" : "To do:"} <button className="underline" onClick={() => onTab("settings")}>Confirm the training year and policy</button></li>
          <li>{counts.setup.staff_count ? `${counts.setup.staff_count} staff added.` : "To do:"} <Link className="underline" href={`/app/employees?action=add&facilityId=${facilityId}&source=train`}>Add staff</Link> or <Link className="underline" href={`/app/employees?action=bulk-import&facilityId=${facilityId}&source=train`}>import a roster</Link></li>
          <li><button className="underline" onClick={() => { changeState("needs_invite"); onTab("students"); }}>Invite staff and review activation</button></li>
          <li>{counts.setup.plan_count ? `${counts.setup.plan_count} plans saved.` : "To do:"} <button className="underline" onClick={() => onTab("yearly-plans")}>Choose courses, set deadlines and assign a learning plan</button></li>
          <li>{counts.setup.assigned_staff} / {counts.setup.staff_count} active staff have required courses. <button className="underline" onClick={() => changeState("no_assignments")}>Review staff needing assignments</button></li>
        </ol>
        <p className="text-xs text-muted-foreground mt-3">Progress is saved with your facility records. Classroom learners without email can have individually recorded attendance and certificates; they cannot activate an email-based online account until an email is added.</p>
      </details>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{([
        ["all", "Active staff", counts.active_staff], ["no_assignments", "Needs required assignments", counts.no_assignments],
        ["needs_invite", "Needs invitation / email", counts.needs_invite], ["needs_activation", "Awaiting activation", counts.needs_activation],
        ["overdue", "Overdue", counts.overdue], ["due_soon", "Due within 7 days", counts.due_soon],
        ["exempt", "Assignment exemptions", counts.exempt], ["plan_attention", "Plan needs attention", counts.plan_attention], ["complete", "Required training complete", counts.complete],
      ] as const).map(([key, label, value]) => <Button key={key} variant={state === key ? "default" : "outline"} className="h-auto whitespace-normal p-4 flex flex-col items-start" onClick={() => changeState(key)}><strong className="text-2xl">{value}</strong><span>{label}</span></Button>)}</div>
      <p className="text-xs text-muted-foreground">Counts cover the searched active roster and chosen year. Due-date, account and plan indicators can overlap. Select Active staff to clear the status filter. Course completion does not certify facility compliance.</p>
      <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr>{["Employee", "Access", "Required training", "Next due", "Actions"].map(label => <th key={label} className="p-2 border-b">{label}</th>)}</tr></thead><tbody>
        {counts.rows.map(row => <tr key={row.employee_id}>
          <td className="p-2 border-b"><button className="underline text-left font-medium" onClick={() => onEmployee(row.employee_id)}>{row.student}</button><p className="text-xs">{row.email || "No email"} · {row.department || "No department"}</p></td>
          <td className="p-2 border-b">{accountLabels[row.account_status] || row.account_status.replaceAll("_", " ")}{row.last_error && <p className="text-xs text-destructive">{row.last_error}</p>}</td>
          <td className="p-2 border-b">{row.required_total ? `${row.required_completed} / ${row.required_total} completed` : "No required courses assigned"}<p className="text-xs">{row.state.replaceAll("_", " ")} · {row.optional_total} optional</p>{row.exemption_reason && <p className="text-xs">{row.exemption_year} exemption: {row.exemption_reason}</p>}</td>
          <td className="p-2 border-b">{formatDateForDisplay(row.next_due)}</td>
          <td className="p-2 border-b"><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => onEmployee(row.employee_id)}>Progress / transcript</Button>
            <Button asChild size="sm" variant="outline"><Link href={`/app/employees/${row.employee_id}?source=train&facilityId=${facilityId}`}>Staff details</Link></Button>
            {canInvite && row.email && !["activated", "accepted", "linked", "revoked"].includes(row.account_status) && <Button size="sm" disabled={busy} onClick={() => void send(row)}>{row.invitation_id ? "Resend invitation" : "Invite learner"}</Button>}
            {["platform_admin", "org_admin", "facility_manager", "trainer"].includes(user?.role || "") && (row.required_total === 0 || row.exemption_reason) && <TrainingAssignmentExemption row={row} />}
          </div></td>
        </tr>)}
      </tbody></table></div>
      {!counts.rows.length && <p>No active employees match this view.</p>}
      <div className="flex gap-3 items-center"><Button variant="outline" disabled={!offset || report.isFetching} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous staff page</Button><span>{counts.total ? `${offset + 1}–${Math.min(offset + 50, counts.total)} of ${counts.total}` : "0 employees"}</span><Button variant="outline" disabled={offset + 50 >= counts.total || report.isFetching} onClick={() => setOffset(offset + 50)}>Next staff page</Button></div>
    </>}
  </section>;
}
