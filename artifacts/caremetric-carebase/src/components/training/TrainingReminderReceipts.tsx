import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { QueryError } from "@/components/QueryState";

type Receipt = { id: string; student: string; course: string; created_at: string; read_at: string | null;
  deliveries: { channel: string; status: string; error_code: string | null; skip_reason: string | null }[] };
export function TrainingReminderReceipts({ facilityId, employeeId }: { facilityId: string; employeeId?: string }) {
  const [open, setOpen] = useState(false);
  const query = useQuery({ queryKey: ["training-enrollment-report", "reminders", facilityId, employeeId], enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_training_reminder_receipts", { p_facility_id: facilityId, p_employee_id: employeeId });
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("Reminder delivery receipts are unavailable");
      return data as unknown as Receipt[];
    } });
  return <details className="border rounded p-3" onToggle={e => setOpen(e.currentTarget.open)}><summary className="cursor-pointer font-medium">Training reminders and delivery results</summary>
    <p className="text-sm my-2">The daily job follows this facility’s reminder settings for unfinished required courses and administrator follow-up. Defaults remind learners within seven days of a deadline and repeat weekly. Channel delivery follows account notification preferences. These are the latest 100 learner reminder receipts; queued or sent does not mean delivered.</p>
    {query.isError ? <QueryError what="reminder receipts" error={query.error} onRetry={() => void query.refetch()} /> : query.isLoading ? <p>Loading reminders…</p> : <ul className="space-y-2">{query.data?.map(r => <li key={r.id} className="border-t pt-2 text-sm"><strong>{r.student} · {r.course}</strong><p>Created {new Date(r.created_at).toLocaleString()} · {r.read_at ? "Read in app" : "Unread in app"}</p><p>{r.deliveries.length ? r.deliveries.map(d => `${d.channel}: ${d.status}${d.error_code ? ` (${d.error_code})` : ""}${d.skip_reason ? ` — ${d.skip_reason}` : ""}`).join("; ") : "In-app reminder recorded; no external delivery receipt."}</p></li>)}</ul>}
    {query.data?.length === 0 && <p className="text-sm">No due-date reminder receipts match this facility and employee.</p>}
  </details>;
}
