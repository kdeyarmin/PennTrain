import { useState } from "react";
import { Button } from "@/components/ui/button";
import { QueryError } from "@/components/QueryState";
import { useTrainingReportAnalytics } from "@/hooks/useTrainingAutomation";
import { saveableTrainingFilters } from "@/lib/trainingAutomation";
import type { TrainingEnrollmentFilters } from "@/lib/trainingEnrollmentReport";
import { formatDateForDisplay } from "@/lib/dateUtils";

export function TrainingReportAnalytics({ facilityId, filters, enabled, onEmployee }: { facilityId: string; filters: TrainingEnrollmentFilters; enabled: boolean; onEmployee: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(14);
  const query = useTrainingReportAnalytics(facilityId, saveableTrainingFilters(filters), days, open && enabled);
  const data = query.data;
  return <details className="rounded-lg border p-4 space-y-4" onToggle={e => setOpen(e.currentTarget.open)}><summary className="font-semibold cursor-pointer">Department comparisons, completion trends & stalled learning</summary>
    <p className="text-sm text-muted-foreground">These analytics use all enrollments matching the report filters above, up to the same 10,000-row export limit. Completion rates describe assigned work, not facility compliance. Staff without assignments are shown on the Staff progress dashboard.</p>
    {!enabled ? <p>Correct the report dates to load analytics.</p> : query.isError ? <QueryError what="training analytics" error={query.error} onRetry={() => void query.refetch()} /> : query.isLoading ? <p>Loading analytics…</p> : data && <>
      <section><h3 className="font-semibold mb-2">Department comparison</h3><div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr>{["Department", "Students with matching work", "Required courses completed", "Required completion", "Not started"].map(label => <th className="border-b p-2" key={label}>{label}</th>)}</tr></thead><tbody>{data.departments.map(row => <tr key={row.department}><td className="p-2 border-b">{row.department}</td><td className="p-2 border-b">{row.students}</td><td className="p-2 border-b">{row.completed} / {row.required}</td><td className="p-2 border-b">{row.required ? `${Math.round(row.completed / row.required * 100)}%` : "No required courses"}</td><td className="p-2 border-b">{row.not_started}</td></tr>)}</tbody></table></div>{!data.departments.length && <p>No matching enrollments.</p>}</section>
      <section><h3 className="font-semibold mb-2">Course completions by month</h3><p className="text-xs text-muted-foreground mb-2">Last 12 calendar months using Pennsylvania completion dates and the current report filters. Counts are completed enrollments, not unique people or historical compliance percentages.</p><div className="grid grid-cols-3 md:grid-cols-6 gap-2">{data.months.map(month => <div key={month.month} className="rounded border p-2"><p className="text-xs">{month.month}</p><p className="font-semibold text-xl">{month.completions}</p></div>)}</div></section>
      <section className="space-y-2"><h3 className="font-semibold">Started courses needing follow-up</h3><label className="flex flex-wrap gap-2 items-center text-sm">No recorded progress for<select className="border rounded p-2 bg-background" value={days} onChange={e => setDays(Number(e.target.value))}>{[7, 14, 30, 60, 90].map(day => <option key={day} value={day}>{day} days</option>)}</select></label><p className="text-xs text-muted-foreground">{data.stalled_total} unfinished started courses match. The oldest 50 are listed. Paused, canceled and completed work is excluded. Offline work appears after synchronization.</p>
        {data.stalled.map(row => <div key={row.id} className="rounded border p-3 flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium">{row.student} · {row.course}</p><p className="text-xs text-muted-foreground">{row.percent_complete}% complete · last recorded progress {formatDateForDisplay(row.last_progress_at)}</p></div><Button variant="outline" size="sm" onClick={() => onEmployee(row.employee_id)}>Review employee progress</Button></div>)}{!data.stalled.length && <p className="text-sm">No started courses match this inactivity window.</p>}
      </section>
    </>}
  </details>;
}
