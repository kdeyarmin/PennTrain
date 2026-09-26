import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { facilityDateTimeLocalToUtcIso } from "@/lib/dateUtils";
import { humanize } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QueryError } from "@/components/QueryState";
import type { Tables } from "@/lib/database.types";

const EVENTS = {
  departure_plan: "Plan discharge or transfer",
  room_cleared: "Record room cleared of personal property",
  facility_closure_plan: "Plan licensed facility closure",
  facility_closed: "Record actual licensed facility closure",
};
const EMPTY = { at: "", reason: "", evidence: "", initiator: "facility", destination: "", certifier: "physician", certification: "" };

export function RegulatoryEvents({ facilityId, residentId, canManage }: { facilityId: string; residentId?: string; canManage: boolean }) {
  const id = useId();
  const client = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<keyof typeof EVENTS>(residentId ? "departure_plan" : "facility_closure_plan");
  const [form, setForm] = useState(EMPTY);
  const query = useQuery({
    queryKey: ["resident_regulatory_events", facilityId, residentId ?? "facility"],
    queryFn: async () => {
      const rows: Tables<"resident_regulatory_events">[] = [];
      for (let from = 0; ; from += 1000) {
        let q = supabase.from("resident_regulatory_events").select("*").eq("facility_id", facilityId).order("created_at", { ascending: false }).order("id").range(from, from + 999);
        q = residentId ? q.eq("resident_id", residentId) : q.is("resident_id", null);
        const { data, error } = await q;
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < 1000) return rows;
      }
    },
  });
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("record_resident_regulatory_event", {
        p_facility_id: facilityId, p_resident_id: residentId, p_event_type: type,
        p_event_at: facilityDateTimeLocalToUtcIso(form.at), p_reason: form.reason.trim(), p_evidence: form.evidence.trim(),
        p_details: type === "departure_plan" ? { initiator: form.initiator, destination: form.destination.trim(),
          ...(form.initiator === "emergency" ? { certifier: form.certifier, certification_evidence: form.certification.trim() } : {}) } : {},
      });
      if (error) throw error;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["resident_regulatory_events"] });
      client.invalidateQueries({ queryKey: ["resident_regulatory_actions"] });
      setOpen(false);
      toast({ title: "Event recorded and applicable deadlines created" });
    },
    onError: (error: Error) => toast({ title: "Could not record event", description: error.message, variant: "destructive" }),
  });
  const field = (key: "at" | "reason" | "evidence" | "destination" | "certification", label: string) => <div className="space-y-1"><Label htmlFor={`${id}-${key}`}>{label}</Label>{key === "at" ? <Input id={`${id}-${key}`} type="datetime-local" value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} /> : <Textarea id={`${id}-${key}`} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} />}</div>;
  const valid = !!form.at && form.reason.trim().length >= 3 && form.evidence.trim().length >= 3 && (type !== "departure_plan" || (form.destination.trim().length >= 3 && (form.initiator !== "emergency" || form.certification.trim().length >= 5)));
  return <div className="rounded-md border p-3 space-y-3">
    <p className="text-sm">Plans create separate notice duties for each recipient. Census departures and contract signatures or amendments create their own linked deadlines. Actual delivery and refund evidence stays on the records below.</p>
    {canManage && <Button variant="outline" onClick={() => { setForm(EMPTY); setType(residentId ? "departure_plan" : "facility_closure_plan"); setOpen(true); }}>Record triggering event</Button>}
    {query.isError ? <QueryError what="regulatory events" error={query.error} onRetry={() => void query.refetch()} /> : query.data?.map(event => <p key={event.id} className="text-xs">{EVENTS[event.event_type as keyof typeof EVENTS]} · {new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }).format(new Date(event.event_at))} · {event.reason} · Evidence: {event.evidence}</p>)}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Record regulatory event</DialogTitle></DialogHeader>
      <Label htmlFor={`${id}-type`}>Event</Label><Select value={type} onValueChange={v => setType(v as keyof typeof EVENTS)}><SelectTrigger id={`${id}-type`}><SelectValue /></SelectTrigger><SelectContent>{Object.entries(EVENTS).filter(([key]) => !!residentId === ["departure_plan", "room_cleared"].includes(key)).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select>
      {field("at", `${type.includes("plan") ? "Planned" : "Actual"} event date and time (Pennsylvania) *`)}
      {field("reason", "Reason *")}{field("evidence", "Decision or event evidence / document reference *")}
      {type === "departure_plan" && <><Label htmlFor={`${id}-initiator`}>Who initiates the departure?</Label><Select value={form.initiator} onValueChange={v => setForm({ ...form, initiator: v })}><SelectTrigger id={`${id}-initiator`}><SelectValue /></SelectTrigger><SelectContent>{["facility", "resident", "emergency", "unknown"].map(v => <SelectItem key={v} value={v}>{humanize(v)}</SelectItem>)}</SelectContent></Select>{field("destination", "Destination (or explicitly record Unknown) *")}
        {form.initiator === "emergency" && <><Label htmlFor={`${id}-certifier`}>Emergency exception certified by</Label><Select value={form.certifier} onValueChange={v => setForm({ ...form, certifier: v })}><SelectTrigger id={`${id}-certifier`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="physician">Physician</SelectItem><SelectItem value="department">Department</SelectItem></SelectContent></Select>{field("certification", "Certification evidence *")}<p className="text-sm">Record practicable notice for an ALF. The exception and actual delivery time remain visible with each notice.</p></>}
      </>}
      {type === "room_cleared" && <p className="text-sm">Use the date all personal property was removed. The fund-return clock starts here. A recorded settlement can satisfy fund return; itemized accounts and housing refunds need separate evidence.</p>}
      {type.startsWith("facility_") && <p className="text-sm">This records a licensed closure and its notices. It does not replace resident census moves or the facility’s operational active/inactive setting.</p>}
      <Button onClick={() => save.mutate()} disabled={!valid || save.isPending}>{save.isPending ? "Recording…" : "Record event"}</Button>
    </DialogContent></Dialog>
  </div>;
}
