import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useListCourses } from "@/hooks/useCourses";
import { type TrainingPlan, type TrainingPlanItem } from "@/hooks/useTrainingPlans";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QueryError } from "@/components/QueryState";

export function PlanAuthoringTools({ plan, items }: { plan: TrainingPlan; items: TrainingPlanItem[] }) {
  const [mode, setMode] = useState<"courses" | "copy" | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [required, setRequired] = useState(true);
  const [name, setName] = useState(`${plan.name} — ${(plan.training_year ?? new Date().getFullYear()) + 1}`);
  const [year, setYear] = useState(String((plan.training_year ?? new Date().getFullYear()) + 1));
  const [deadline, setDeadline] = useState("");
  const [receipt, setReceipt] = useState("");
  const client = useQueryClient();
  const catalog = useListCourses({}, mode === "courses");
  const courses = (catalog.data ?? []).filter(c => c.status === "published" && c.current_version_id
    && (!c.organization_id || c.organization_id === plan.organization_id) && !items.some(i => i.course_id === c.id)
    && `${c.title} ${c.category ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const mutation = useMutation({ mutationFn: async () => {
    if (mode === "copy") {
      const { error } = await supabase.rpc("copy_yearly_training_plan", { p_plan_id: plan.id,
        p_name: name.trim(), p_training_year: Number(year), p_due_date: deadline });
      if (error) throw error;
      return "Plan copied. Review its courses, then apply it to employees when ready.";
    }
    const next = Math.max(-1, ...items.map(i => i.sort_order)) + 1;
    const { error } = await supabase.from("training_plan_items").insert(selected.map((id, index) => ({
      training_plan_id: plan.id, course_id: id, is_required: required, sort_order: next + index,
    })));
    if (error) throw error;
    return `${selected.length} courses added. Apply the updated plan to your selected employees.`;
  }, onSuccess: async message => {
    await Promise.all([client.invalidateQueries({ queryKey: ["training_plans"] }), client.invalidateQueries({ queryKey: ["course_assignments"] })]);
    setSelected([]); setMode(null); setReceipt(message);
  } });
  const open = (value: "courses" | "copy") => { mutation.reset(); setReceipt(""); setMode(value); };
  return <>
    <Button size="sm" variant="outline" onClick={() => open("courses")}>Add multiple courses</Button>
    {plan.facility_id && <Button size="sm" variant="outline" onClick={() => open("copy")}>Copy to next year</Button>}
    {receipt && <p role="status" className="text-sm">{receipt}</p>}
    <Dialog open={mode !== null} onOpenChange={value => { if (!value && !mutation.isPending) setMode(null); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto"><DialogHeader>
        <DialogTitle>{mode === "copy" ? "Copy learning plan" : "Choose courses"}</DialogTitle>
        <DialogDescription>{mode === "copy" ? "Copies courses and required/optional choices. Enter a new deadline; employee assignments and completion history stay with their original plan." : "Search published courses and select several at once. All selected courses are added together."}</DialogDescription>
      </DialogHeader>
      <fieldset disabled={mutation.isPending} className="space-y-4">
        {mode === "copy" ? <>
          <label className="block">New plan name<Input value={name} maxLength={200} onChange={e => setName(e.target.value)} /></label>
          <label className="block">New training year<Input type="number" min={1990} max={2200} value={year} onChange={e => setYear(e.target.value)} /></label>
          <label className="block">New completion deadline<Input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} /></label>
        </> : <>
          <label className="block">Find courses<Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Title or category" /></label>
          <label className="flex gap-2"><input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)} /> Required courses</label>
          {catalog.isError ? <QueryError what="course library" error={catalog.error} onRetry={() => void catalog.refetch()} /> : catalog.isLoading ? <p>Loading courses…</p> : <div className="max-h-72 overflow-y-auto space-y-2">{courses.map(c => <label className="flex gap-2 p-2 border rounded" key={c.id}><input type="checkbox" checked={selected.includes(c.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, c.id] : ids.filter(id => id !== c.id))} /><span>{c.title}</span></label>)}{!courses.length && <p>No additional published courses match.</p>}</div>}
        </>}
        {mutation.isError && <p role="alert" className="text-destructive">{mutation.error.message}</p>}
        <div className="flex gap-2"><Button variant="outline" onClick={() => setMode(null)}>Cancel</Button><Button disabled={mode === "copy" ? !name.trim() || !deadline || Number(year) < 1990 || Number(year) > 2200 || !Number.isInteger(Number(year)) : !selected.length || catalog.isError} onClick={() => mutation.mutate()}>{mutation.isPending ? "Saving…" : mode === "copy" ? "Create copied plan" : `Add ${selected.length} courses`}</Button></div>
      </fieldset></DialogContent>
    </Dialog>
  </>;
}
