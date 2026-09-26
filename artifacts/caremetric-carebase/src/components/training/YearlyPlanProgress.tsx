import { useTrainingPlanProgress, useResolveTrainingPlanAssignment } from "@/hooks/useTrainingProgress";
import { Button } from "@/components/ui/button";
import { QueryError } from "@/components/QueryState";
import { useToast } from "@/hooks/use-toast";
import { formatDateForDisplay } from "@/lib/dateUtils";

export default function YearlyPlanProgress({ planId, canManage }: { planId: string; canManage: boolean }) {
  const query = useTrainingPlanProgress(planId);
  const resolve = useResolveTrainingPlanAssignment();
  const { toast } = useToast();
  if (query.isLoading) return <p role="status">Loading plan requirements…</p>;
  if (query.isError) return <QueryError what="plan progress" error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data?.length) return <p>This plan has not been applied to an employee yet.</p>;
  return <div className="space-y-3">{query.data.map(row => <article key={row.employee_id} className="border rounded-lg p-3 space-y-2">
    <div className="flex justify-between gap-2 flex-wrap"><strong>{row.student}</strong><span>{row.completed} / {row.required} required courses complete</span></div>
    {row.needs_reapply && <p role="status" className="text-amber-700">Plan changes have not been applied to this employee. Apply the plan again to update their assignments.</p>}
    {!row.needs_reapply && row.required > 0 && row.completed === row.required && row.unresolved === 0 && <p className="text-emerald-700">Plan complete</p>}
    {!row.required && <p>No required courses in this plan.</p>}
    <ul className="space-y-2">{row.items.map(item => <li key={item.course_id} className="text-sm">
      <span>{item.title} · {item.required ? "Required" : "Optional"} · {item.status.replaceAll("_", " ")}</span>
      {item.conflict_assignment_id && <div className="mt-1 rounded border p-2"><p>An assignment already exists outside this plan. Its deadline is {item.conflict_due_date ? formatDateForDisplay(item.conflict_due_date) : "not set"}.</p>
        {canManage && <Button size="sm" variant="outline" disabled={resolve.isPending} onClick={() => resolve.mutate({ planId, employeeId: row.employee_id, assignmentId: item.conflict_assignment_id! }, {
          onSuccess: () => toast({ title: "Existing assignment linked; its original deadline is unchanged" }),
          onError: error => toast({ title: "Could not resolve plan requirement", description: error.message, variant: "destructive" }),
        })}>Use existing assignment for this requirement</Button>}
      </div>}
    </li>)}</ul>
  </article>)}</div>;
}
