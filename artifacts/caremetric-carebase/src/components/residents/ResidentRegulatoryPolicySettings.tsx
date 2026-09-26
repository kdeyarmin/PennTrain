import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useGetFacility } from "@/hooks/useFacilities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

export const RESIDENT_POLICY_DEFAULTS = { alf_admission_grace_days: 0, alf_contract_timing: "before_admission", revision_grace_days: 0, medication_reportability: "all_events" };
export function ResidentRegulatoryPolicySettings({ facilityId, canManage }: { facilityId: string; canManage: boolean }) {
  const { data } = useGetFacility(facilityId);
  const { toast } = useToast();
  const cache = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string | number> | null>(null);
  const [campus, setCampus] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const facility = data;
  const savedPolicy = facility?.resident_regulatory_policy;
  const policy = draft ?? { ...RESIDENT_POLICY_DEFAULTS, ...(savedPolicy && typeof savedPolicy === "object" && !Array.isArray(savedPolicy) ? savedPolicy as Record<string, string | number> : {}) };
  const save = useMutation({ mutationFn: async () => {
    const { error } = await supabase.rpc("save_resident_regulatory_policy" as never, { p_facility_id: facilityId, p_policy: policy, p_reason: reason, p_campus_identifier: campus ?? facility?.campus_identifier ?? null } as never);
    if (error) throw error;
  }, onSuccess: () => { void cache.invalidateQueries({ queryKey: ["facilities"] }); void cache.invalidateQueries({ queryKey: ["resident_compliance_items"] }); setDraft(null); setCampus(null); setReason(""); toast({ title: "Resident policy recorded" }); }, onError: (error: Error) => toast({ title: "Could not save policy", description: error.message, variant: "destructive" }) });
  const choice = (key: keyof typeof RESIDENT_POLICY_DEFAULTS, label: string, options: [string, string][]) => <div className="space-y-1"><Label htmlFor={`resident-policy-${key}`}>{label}</Label><Select disabled={!canManage} value={String(policy[key])} onValueChange={value => setDraft({ ...policy, [key]: key.endsWith("_days") ? Number(value) : value })}><SelectTrigger id={`resident-policy-${key}`}><SelectValue /></SelectTrigger><SelectContent>{options.map(([value, text]) => <SelectItem key={value} value={value}>{text}</SelectItem>)}</SelectContent></Select></div>;
  if (!facility || !["PCH", "ALR"].includes(facility.facility_type)) return null;
  return <Card><CardHeader><CardTitle>Resident regulatory policy</CardTitle></CardHeader><CardContent className="space-y-3">
    <p className="text-sm text-muted-foreground">Record the facility's adopted interpretation and supporting decision. Defaults keep the existing stricter deadlines. Changes affect open duties; completed evidence remains unchanged.</p>
    {facility.facility_type === "ALR" && <>
      {choice("alf_admission_grace_days", "ALF initial DME / assessment grace", [["0", "No grace — regulation and RCG front matter"], ["15", "15 days — RCG admission discussion"]])}
      <p className="text-xs text-muted-foreground">The 2800 guide's admission discussion conflicts with its exclusion list. This policy does not replace the documented expedited-admission basis.</p>
      {choice("alf_contract_timing", "ALF resident contract", [["before_admission", "Complete before admission"], ["within_24_hours", "Complete within 24 hours after actual admission (§22(a)(5))"]])}
    </>}
    {choice("revision_grace_days", "Support-plan revision grace (§227(c))", [["0", "No grace — current facility policy"], ["5", "5 days — RCG monthly timeframe grace"]])}
    {choice("medication_reportability", "Medication-event initial reportability", [["all_events", "Presume every medication event reportable"], ["statutory_errors", "Presume staff medication errors; review other events"]])}
    <p className="text-xs text-muted-foreground">Near misses, self-administration errors and adverse reactions still require a documented reportability decision. Medication care and notification duties continue independently.</p>
    <Label htmlFor="resident-campus">Licensed homes on the same campus — shared campus identifier</Label><Input id="resident-campus" disabled={!canManage} value={campus ?? facility.campus_identifier ?? ""} onChange={event => setCampus(event.target.value)} />
    <p className="text-xs text-muted-foreground">Use the same identifier only for licensed homes physically on the same campus. A transfer also requires a dated addendum and eligible carried evidence.</p>
    {canManage && <><Label htmlFor="resident-policy-reason">Decision and supporting policy / DHS guidance reference</Label><Input id="resident-policy-reason" value={reason} onChange={event => setReason(event.target.value)} /><Button disabled={reason.trim().length < 10 || save.isPending} onClick={() => save.mutate()}>Save resident policy</Button></>}
  </CardContent></Card>;
}
