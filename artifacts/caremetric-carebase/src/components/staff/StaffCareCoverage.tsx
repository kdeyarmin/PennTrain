import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
export type StaffCareCoverageData = {
  basis: string;
  days: { day: string; required_hours: number; unknown_mobility: number; available_hours: number; waking_hours: number }[];
  intervals: { starts: string; ends: string; census: number; direct_staff: number; awake_staff: number; adult21_staff: number;
    unknown_staff: number; unknown_mobility: number; all_must_be_awake: boolean; awake_minimum: number }[];
  assignments: { id: string; employee_name: string; starts: string; ends: string; awake_direct_care: boolean | null; role_category: string | null }[];
};
const time = (value: string) => new Date(value).toLocaleString("en-US", { timeZone: "America/New_York" });
export function StaffCareCoverage({ data }: { data: StaffCareCoverageData }) {
  const client = useQueryClient(); const { user } = useAuth(); const { toast } = useToast();
  const save = useMutation({ mutationFn: async ({ id, awake }: { id: string; awake: boolean | null }) => {
    const { error } = await supabase.rpc("record_shift_awake_coverage", { p_assignment_id: id, p_awake: awake! });
    if (error) throw error;
  }, onSuccess: () => client.invalidateQueries({ queryKey: ["schedule-service-workload"] }),
  onError: error => toast({ title: "Awake coverage could not be saved", description: String(error), variant: "destructive" }) });
  const canEdit = ["org_admin", "facility_manager", "platform_admin"].includes(user?.role ?? "");
  const gaps = data.intervals.filter(r => r.census > 0 && (r.adult21_staff < 1 || r.awake_staff < r.awake_minimum
    || (r.all_must_be_awake && r.awake_staff < r.direct_staff) || r.unknown_staff > 0));
  return <section className="space-y-3 rounded border p-3">
    <h4 className="font-medium">Personal care hours, adult coverage and awake staff</h4>
    <p className="text-xs text-muted-foreground">{data.basis} §57 requires one daily hour per mobile resident, two per resident with mobility needs, with 75% available during waking hours. A direct-care person aged 21 or older must be present. §58 requires all direct-care staff awake in ALFs and PCHs with 16+ residents; smaller PCHs with mobility needs require at least one.</p>
    <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr><th className="text-left">Day</th><th>Awake care hours / required</th><th>Waking hours / 75%</th><th>Mobility assessment gaps</th></tr></thead><tbody>{data.days.map(d => <tr key={d.day} className={d.unknown_mobility || d.available_hours < d.required_hours || d.waking_hours < d.required_hours * .75 ? "bg-red-50" : ""}><td>{d.day}</td><td className="text-center">{d.available_hours}/{d.required_hours}{d.unknown_mobility ? "+" : ""}</td><td className="text-center">{d.waking_hours}/{(d.required_hours * .75).toFixed(2)}</td><td className="text-center">{d.unknown_mobility}</td></tr>)}</tbody></table></div>
    <details><summary className="text-sm">{gaps.length} intervals need adult / awake coverage review</summary><ul className="mt-2 space-y-1 text-xs">{gaps.map(r => <li key={r.starts}>{time(r.starts)} – {time(r.ends)}: {r.adult21_staff} aged 21+, {r.awake_staff}/{r.direct_staff} direct-care staff recorded awake, {r.unknown_staff} unknown staff classifications.</li>)}</ul></details>
    <details><summary className="text-sm">Record awake availability for assigned staff</summary><div className="mt-2 space-y-2">{data.assignments.map(a => <label key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-xs"><span>{a.employee_name} · {time(a.starts)} · {a.role_category?.replaceAll("_", " ") ?? "role evidence missing"}</span><select aria-label={`Awake availability for ${a.employee_name} ${a.starts}`} disabled={!canEdit || save.isPending} className="rounded border p-1" value={a.awake_direct_care === null ? "unknown" : a.awake_direct_care ? "yes" : "no"} onChange={e => save.mutate({ id: a.id, awake: e.target.value === "unknown" ? null : e.target.value === "yes" })}><option value="unknown">Not recorded</option><option value="yes">Awake / available</option><option value="no">Sleeping / unavailable</option></select></label>)}</div></details>
  </section>;
}
