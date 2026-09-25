import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { facilityToday } from "@/lib/dateUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { TrainingRosterRow } from "@/hooks/useTrainingProgress";

export function TrainingAssignmentExemption({ row }: { row: TrainingRosterRow }) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(String(row.exemption_year ?? Number(facilityToday().slice(0, 4))));
  const [reason, setReason] = useState(row.exemption_reason || "");
  const client = useQueryClient();
  const mutation = useMutation({ mutationFn: async (remove: boolean) => {
    const { error } = await supabase.rpc("set_training_assignment_exemption", { p_employee_id: row.employee_id,
      p_training_year: Number(year), p_reason: remove ? null! : reason.trim() });
    if (error) throw error;
  }, onSuccess: async () => { await client.invalidateQueries({ queryKey: ["course_assignments", "training-roster"] }); setOpen(false); } });
  return <><Button size="sm" variant="ghost" onClick={() => { mutation.reset(); setOpen(true); }}>{row.exemption_reason ? "Review assignment exemption" : "Record assignment exemption"}</Button>
    <Dialog open={open} onOpenChange={value => { if (!mutation.isPending) setOpen(value); }}><DialogContent><DialogHeader>
      <DialogTitle>Assignment exemption for {row.student}</DialogTitle>
      <DialogDescription>Record why this employee needs no assigned courses for a specific year. Existing required courses still count. This decision does not waive qualifications, evidence, or regulatory requirements; its reason and author are audited.</DialogDescription>
    </DialogHeader><fieldset disabled={mutation.isPending} className="space-y-3">
      <label className="block">Exemption year<Input type="number" min={1990} max={2200} value={year} onChange={e => setYear(e.target.value)} /></label>
      <label className="block">Reason<Textarea value={reason} minLength={10} maxLength={1000} onChange={e => setReason(e.target.value)} /></label>
      {mutation.isError && <p role="alert">{mutation.error.message}</p>}
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
        {row.exemption_year === Number(year) && <Button variant="outline" onClick={() => mutation.mutate(true)}>Remove exemption</Button>}
        <Button disabled={reason.trim().length < 10 || !Number.isInteger(Number(year)) || Number(year) < 1990 || Number(year) > 2200} onClick={() => mutation.mutate(false)}>Save assignment exemption</Button></div>
    </fieldset></DialogContent></Dialog></>;
}
