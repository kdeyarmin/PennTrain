import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useEmployeeRegulatoryProfile, useSaveStaffRegulatorySettings, type EmployeeRegulatoryProfile as Profile } from "@/hooks/useStaffRegulatory";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { QueryError } from "@/components/QueryState";
import { useToast } from "@/hooks/use-toast";
const empty: Profile = { birth_date: null, education: "unknown", role_category: "unknown", education_evidence: "", medical_fitness_confirmed: false,
  licensed_professional_exemption: false, professional_exemption_valid_until: null, exemption_evidence: "", continuous_service_since: null, adl_competency_verified_on: null, adl_competency_evidence: "" };
export function EmployeeRegulatoryProfile({ facilityId, employeeId }: { facilityId: string; employeeId: string }) {
  const query = useEmployeeRegulatoryProfile(employeeId);
  const save = useSaveStaffRegulatorySettings();
  const { user } = useAuth(); const { toast } = useToast();
  const [draft, setDraft] = useState<Profile | null>(null);
  const p = draft ?? query.data ?? empty;
  const canEdit = ["org_admin", "facility_manager", "platform_admin"].includes(user?.role ?? "");
  const set = <K extends keyof Profile>(key: K, value: Profile[K]) => setDraft(previous => ({ ...(previous ?? p), [key]: value }));
  return <Card><CardHeader><CardTitle>Staff qualification evidence</CardTitle></CardHeader><CardContent className="space-y-3">
    <p className="text-sm text-muted-foreground">§54 age, education and fitness; §65 initial-training exemptions and PCH supervised ADL competency. Evidence is required before an exemption or independent ADL assignment can qualify.</p>
    {query.isError ? <QueryError what="staff qualification evidence" error={query.error} onRetry={() => query.refetch()} /> : <fieldset className="space-y-3" disabled={!canEdit || save.isPending || query.isLoading}>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm">Date of birth<Input type="date" value={p.birth_date ?? ""} onChange={e => set("birth_date", e.target.value || null)} /></label>
        <label className="text-sm">Role<select className="block w-full rounded border p-2" value={p.role_category} onChange={e => set("role_category", e.target.value)}>{["unknown", "direct_care", "food_service", "housekeeping", "other"].map(v => <option key={v} value={v}>{v.replaceAll("_", " ")}</option>)}</select></label>
        <label className="text-sm">Education<select className="block w-full rounded border p-2" value={p.education} onChange={e => set("education", e.target.value)}>{["unknown", "high_school", "ged", "nurse_aide_registry", "none"].map(v => <option key={v} value={v}>{v.replaceAll("_", " ")}</option>)}</select></label>
        <label className="text-sm">Education / registry evidence reference<Input value={p.education_evidence} onChange={e => set("education_evidence", e.target.value)} /></label>
        <label className="text-sm">Continuous service since (no break over one year)<Input type="date" value={p.continuous_service_since ?? ""} onChange={e => set("continuous_service_since", e.target.value || null)} /></label>
        <label className="text-sm">ADL competency verified on<Input type="date" value={p.adl_competency_verified_on ?? ""} onChange={e => set("adl_competency_verified_on", e.target.value || null)} /></label>
      </div>
      <label className="block text-sm">Supervised ADL demonstration evidence<Input value={p.adl_competency_evidence} onChange={e => set("adl_competency_evidence", e.target.value)} /></label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={p.medical_fitness_confirmed} onChange={e => set("medical_fitness_confirmed", e.target.checked)} />Fit to perform assigned duties (§54(a)(3))</label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={p.licensed_professional_exemption} onChange={e => set("licensed_professional_exemption", e.target.checked)} />Current CNA, LPN, RN, physician or EMT initial-training exemption verified</label>
      <label className="block text-sm">Exemption evidence (credential and good standing)<Input value={p.exemption_evidence} onChange={e => set("exemption_evidence", e.target.value)} /></label>
      <label className="block text-sm">Professional credential valid through<Input type="date" value={p.professional_exemption_valid_until ?? ""} onChange={e => set("professional_exemption_valid_until", e.target.value || null)} /></label>
      {canEdit && <Button onClick={async () => { try { await save.mutateAsync({ facilityId, employeeId, data: { ...p } }); setDraft(null); toast({ title: "Qualification evidence saved" }); }
        catch (error) { toast({ title: "Evidence could not be saved", description: String(error), variant: "destructive" }); } }}>Save qualification evidence</Button>}
    </fieldset>}
  </CardContent></Card>;
}
