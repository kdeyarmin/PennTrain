import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useStaffRegulatoryPolicy, useSaveStaffRegulatorySettings, type StaffRegulatoryPolicy as Policy } from "@/hooks/useStaffRegulatory";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { QueryError } from "@/components/QueryState";

export function StaffRegulatoryPolicy({ facilityId, facilityType }: { facilityId: string; facilityType: string }) {
  const query = useStaffRegulatoryPolicy(facilityId);
  const save = useSaveStaffRegulatorySettings();
  const { user } = useAuth();
  const { toast } = useToast();
  const [draft, setDraft] = useState<Policy | null>(null);
  const policy = draft ?? query.data;
  const canEdit = ["org_admin", "facility_manager", "platform_admin"].includes(user?.role ?? "");
  const set = <K extends keyof Policy>(key: K, value: Policy[K]) => setDraft(p => ({ ...(p ?? query.data!), [key]: value }));
  const isPch = facilityType === "PCH", isAlr = facilityType === "ALR";
  return <Card><CardHeader><CardTitle>{isPch ? "PCH · Chapter 2600" : isAlr ? "ALF · Chapter 2800" : "Staff"} regulatory policy</CardTitle></CardHeader><CardContent className="space-y-4">
    <p className="text-sm text-muted-foreground">The selected license determines the DHS requirements. Defaults add no recurring clearance checks{isPch ? " or optional PCH prerequisites" : ""}. Saved facility policies may be stricter and remain in effect until you revise them. Training-year dates are set in Train → Facility policy. Saving keeps all underlying evidence.</p>
    {query.isError ? <QueryError what="staff policy" error={query.error} onRetry={() => query.refetch()} /> : !policy ? <p>Loading policy…</p> :
      <fieldset disabled={!canEdit || save.isPending} className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">Medication course renewal years (optional facility policy; blank = initial course only)<Input type="number" min="1" max="10" value={policy.medication_course_years ?? ""} onChange={e => set("medication_course_years", e.target.value ? Number(e.target.value) : null)} /></label>
          <label className="text-sm">Medication trainer recertification years (3 per RCG; shorter = facility policy)<Input type="number" min="1" max="3" value={policy.trainer_recertification_years} onChange={e => set("trainer_recertification_years", Number(e.target.value))} /></label>
          <label className="text-sm">Annual training grace days (15 per RCG; shorter = facility policy)<Input type="number" min="0" max="15" value={policy.annual_grace_days} onChange={e => set("annual_grace_days", Number(e.target.value))} /></label>
          {isAlr && <label className="text-sm">ALF initial-training transfer months (12 under §2800.65(k); shorter = facility policy)<Input type="number" min="1" max="12" value={policy.alf_transfer_months ?? 12} onChange={e => set("alf_transfer_months", e.target.value ? Number(e.target.value) : 12)} /></label>}
          <label className="text-sm">Clearance renewal years (facility policy; blank = no recurrence)<Input type="number" min="1" max="5" value={policy.clearance_renewal_years ?? ""} onChange={e => set("clearance_renewal_years", e.target.value ? Number(e.target.value) : null)} /></label>
          <label className="text-sm">Resident waking hours begin (facility policy)<Input type="time" value={policy.waking_start ?? "07:00"} onChange={e => set("waking_start", e.target.value)} /></label>
          <label className="text-sm">Resident waking hours end (same day)<Input type="time" value={policy.waking_end ?? "23:00"} onChange={e => set("waking_end", e.target.value)} /></label>
        </div>
        <p className="text-xs text-muted-foreground">The applicable RCG §190 requires the annual practicum; the initial course/test does not repeat every two years. Train-the-Trainer recertifies every three years. {isAlr ? "Section 2800.65(k) limits the initial-training exception to training at another residence within the past year. Section 2800.55's broader recognition of prior qualifications does not remove that condition. Chapter 2800 has no express general OJT allowance." : "Section 2600.65(h) limits the initial-training exception to training at another home within the past year. PCH general annual training may include up to six hours of on-the-job training."}</p>
        {([
          ["alf_ojt_allowed", "Allow ALF general annual OJT credit (facility interpretation; regulatory basis requires review)"],
          ["staff_tb_required", "Require employee TB screening as facility policy"],
          ["pch_cpr_before_care", "Require CPR/first aid before PCH care as facility policy"],
          ["pch_dementia_30day", "Require PCH dementia training within 30 days as facility policy"],
        ] as const).filter(([key]) => key.startsWith("alf_") ? isAlr : key.startsWith("pch_") ? isPch : true).map(([key, label]) => <label className="flex items-start gap-2 text-sm" key={key}><input type="checkbox" checked={policy[key]} onChange={e => set(key, e.target.checked)} />{label}</label>)}
        <label className="block text-sm">Policy reference and rationale<Input value={policy.policy_reference} onChange={e => set("policy_reference", e.target.value)} /></label>
        {canEdit && <Button disabled={policy.policy_reference.trim().length < 5} onClick={async () => {
          try { await save.mutateAsync({ facilityId, data: { ...policy } }); setDraft(null); toast({ title: "Staff policy saved" }); }
          catch (error) { toast({ title: "Policy could not be saved", description: String(error), variant: "destructive" }); }
        }}>Save staff policy</Button>}
      </fieldset>}
  </CardContent></Card>;
}
