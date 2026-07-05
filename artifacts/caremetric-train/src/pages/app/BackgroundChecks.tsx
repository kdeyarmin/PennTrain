import { useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useListEmployees } from "@/hooks/useEmployees";
import { useListFacilities } from "@/hooks/useFacilities";
import { useGetOrganizationSettings } from "@/hooks/useOrganizationSettings";
import {
  useListBackgroundCheckProfiles, useUpsertBackgroundCheckProfile, type BackgroundCheckProfile,
} from "@/hooks/useBackgroundCheckProfiles";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ShieldQuestion } from "lucide-react";

const SUITABILITY_LABELS: Record<string, string> = {
  pending: "Pending",
  suitable: "Suitable",
  suitable_with_conditions: "Suitable (Conditions)",
  not_suitable: "Not Suitable",
};

function suitabilityBadgeClass(determination: string): string {
  switch (determination) {
    case "suitable": return "bg-success text-success-foreground hover:bg-success/80";
    case "suitable_with_conditions": return "bg-warning text-warning-foreground hover:bg-warning/80";
    case "not_suitable": return "bg-destructive text-destructive-foreground hover:bg-destructive/80";
    default: return "bg-muted text-muted-foreground";
  }
}

function provisionalStatus(profile: BackgroundCheckProfile | undefined): { label: string; className: string } | null {
  if (!profile?.provisional_start_date || !profile.provisional_max_days) return null;
  const start = new Date(`${profile.provisional_start_date}T00:00:00`);
  const daysElapsed = Math.floor((Date.now() - start.getTime()) / (1000 * 60 * 60 * 24));
  const remaining = profile.provisional_max_days - daysElapsed;
  if (remaining < 0) {
    return { label: `Provisional period expired ${Math.abs(remaining)}d ago`, className: "bg-destructive text-destructive-foreground hover:bg-destructive/80" };
  }
  if (remaining <= 7) {
    return { label: `${remaining}d left on provisional period`, className: "bg-warning text-warning-foreground hover:bg-warning/80" };
  }
  return { label: `${remaining}d left on provisional period`, className: "bg-info text-info-foreground hover:bg-info/80" };
}

interface ProfileFormData {
  paResidentTwoYears: string;
  provisionalStartDate: string;
  nonDisqStatementSigned: boolean;
  supervisionConfirmed: boolean;
  supervisionNotes: string;
  suitabilityDetermination: BackgroundCheckProfile["suitability_determination"];
  suitabilityConditions: string;
  suitabilityNotes: string;
}

export default function BackgroundChecks() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [facilityFilter, setFacilityFilter] = useState("all");
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [form, setForm] = useState<ProfileFormData | null>(null);

  const { data: facilities } = useListFacilities();
  const { data: employees, isLoading: employeesLoading } = useListEmployees({ status: "active" });
  const { data: profiles } = useListBackgroundCheckProfiles({ organizationId: user?.organizationId ?? undefined });
  const { data: orgSettings } = useGetOrganizationSettings(user?.organizationId ?? undefined);
  const { mutateAsync: upsertProfile, isPending: saving } = useUpsertBackgroundCheckProfile();

  const profileByEmployeeId = useMemo(() => new Map((profiles ?? []).map((p) => [p.employee_id, p])), [profiles]);

  const filteredEmployees = useMemo(
    () =>
      (employees ?? [])
        .filter((e) => facilityFilter === "all" || e.facility_id === facilityFilter)
        .slice()
        .sort((a, b) => `${a.last_name}${a.first_name}`.localeCompare(`${b.last_name}${b.first_name}`)),
    [employees, facilityFilter],
  );

  const openEditor = (employeeId: string) => {
    const existing = profileByEmployeeId.get(employeeId);
    setEditingEmployeeId(employeeId);
    setForm({
      paResidentTwoYears: existing?.pa_resident_two_years === true ? "yes" : existing?.pa_resident_two_years === false ? "no" : "unknown",
      provisionalStartDate: existing?.provisional_start_date ?? "",
      nonDisqStatementSigned: existing?.non_disqualification_statement_signed ?? false,
      supervisionConfirmed: existing?.supervision_attestation_confirmed ?? false,
      supervisionNotes: existing?.supervision_attestation_notes ?? "",
      suitabilityDetermination: existing?.suitability_determination ?? "pending",
      suitabilityConditions: existing?.suitability_conditions ?? "",
      suitabilityNotes: existing?.suitability_notes ?? "",
    });
  };

  const field = <K extends keyof ProfileFormData>(k: K, v: ProfileFormData[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const handleSave = async () => {
    if (!editingEmployeeId || !form || !user?.organizationId) return;
    const employee = (employees ?? []).find((e) => e.id === editingEmployeeId);
    if (!employee) return;

    const paResident = form.paResidentTwoYears === "yes" ? true : form.paResidentTwoYears === "no" ? false : null;
    const provisionalMaxDays = form.provisionalStartDate
      ? (paResident === false
          ? orgSettings?.oapsa_provisional_days_nonresident ?? 90
          : orgSettings?.oapsa_provisional_days_resident ?? 30)
      : null;

    try {
      await upsertProfile({
        organization_id: employee.organization_id,
        facility_id: employee.facility_id,
        employee_id: employee.id,
        pa_resident_two_years: paResident,
        provisional_start_date: form.provisionalStartDate || null,
        provisional_max_days: provisionalMaxDays,
        non_disqualification_statement_signed: form.nonDisqStatementSigned,
        non_disqualification_statement_signed_at: form.nonDisqStatementSigned ? new Date().toISOString() : null,
        supervision_attestation_confirmed: form.supervisionConfirmed,
        supervision_attestation_confirmed_by: form.supervisionConfirmed ? user.id : null,
        supervision_attestation_confirmed_at: form.supervisionConfirmed ? new Date().toISOString() : null,
        supervision_attestation_notes: form.supervisionNotes || null,
        suitability_determination: form.suitabilityDetermination,
        suitability_conditions: form.suitabilityConditions || null,
        suitability_determined_by: form.suitabilityDetermination !== "pending" ? user.id : null,
        suitability_determined_at: form.suitabilityDetermination !== "pending" ? new Date().toISOString() : null,
        suitability_notes: form.suitabilityNotes || null,
      });
      toast({ title: "Background check profile saved" });
      setEditingEmployeeId(null);
      setForm(null);
    } catch (e) {
      toast({ variant: "destructive", title: "Couldn't save profile", description: e instanceof Error ? e.message : String(e) });
    }
  };

  const editingEmployee = (employees ?? []).find((e) => e.id === editingEmployeeId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Background Checks</h1>
        <p className="text-muted-foreground">
          PA-residency-driven FBI requirement, OAPSA provisional-employment countdown, and documented suitability determinations.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="flex items-center gap-2"><ShieldQuestion className="h-5 w-5" /> Roster ({filteredEmployees.length})</CardTitle>
            <Select value={facilityFilter} onValueChange={setFacilityFilter}>
              <SelectTrigger className="w-48"><SelectValue placeholder="All Facilities" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Facilities</SelectItem>
                {facilities?.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {employeesLoading ? (
            <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-muted animate-pulse rounded" />)}</div>
          ) : (
            <div className="space-y-2">
              {filteredEmployees.map((emp) => {
                const profile = profileByEmployeeId.get(emp.id);
                const provisional = provisionalStatus(profile);
                return (
                  <div key={emp.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{emp.first_name} {emp.last_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {profile?.pa_resident_two_years === true ? "PA resident 2+ years" : profile?.pa_resident_two_years === false ? "Not a 2-year PA resident (FBI check required)" : "PA residency not yet recorded"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                      {provisional && <Badge className={provisional.className}>{provisional.label}</Badge>}
                      <Badge className={suitabilityBadgeClass(profile?.suitability_determination ?? "pending")}>
                        {SUITABILITY_LABELS[profile?.suitability_determination ?? "pending"]}
                      </Badge>
                      <Button size="sm" variant="outline" onClick={() => openEditor(emp.id)}>Manage</Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editingEmployeeId} onOpenChange={(o) => { if (!o) { setEditingEmployeeId(null); setForm(null); } }}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingEmployee ? `${editingEmployee.first_name} ${editingEmployee.last_name}` : ""}</DialogTitle>
            <DialogDescription>Background-check decision logic, provisional-employment tracking, and suitability determination.</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-[13px]">PA resident for the preceding 2 years?</Label>
                <Select value={form.paResidentTwoYears} onValueChange={(v) => field("paResidentTwoYears", v)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unknown">Not yet determined</SelectItem>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  If "No", an Act 73 FBI Fingerprint Clearance requirement is automatically tracked on the Credentials page.
                </p>
              </div>

              <div className="space-y-1.5 pt-2 border-t">
                <Label className="text-[13px]">Provisional employment start date</Label>
                <Input type="date" value={form.provisionalStartDate} onChange={(e) => field("provisionalStartDate", e.target.value)} className="h-9" />
                <p className="text-xs text-muted-foreground">
                  Countdown defaults to {orgSettings?.oapsa_provisional_days_resident ?? 30} days (PA resident) / {orgSettings?.oapsa_provisional_days_nonresident ?? 90} days
                  (non-resident), based on OAPSA (6 Pa Code Sec 15.146) and the parallel PA Code provisions for personal care homes -- confirm the applicable figure with your own regulatory counsel.
                </p>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={form.nonDisqStatementSigned} onCheckedChange={(v) => field("nonDisqStatementSigned", !!v)} className="mt-0.5" />
                Applicant has signed a written statement affirming they are not disqualified from employment under OAPSA.
              </label>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={form.supervisionConfirmed} onCheckedChange={(v) => field("supervisionConfirmed", !!v)} className="mt-0.5" />
                Regular/random direct supervision during the provisional period is documented.
              </label>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Supervision notes</Label>
                <Textarea value={form.supervisionNotes} onChange={(e) => field("supervisionNotes", e.target.value)} rows={2} />
              </div>

              <div className="space-y-1.5 pt-2 border-t">
                <Label className="text-[13px]">Suitability determination</Label>
                <Select value={form.suitabilityDetermination} onValueChange={(v) => field("suitabilityDetermination", v as ProfileFormData["suitabilityDetermination"])}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(SUITABILITY_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {form.suitabilityDetermination === "suitable_with_conditions" && (
                <div className="space-y-1.5">
                  <Label className="text-[13px]">Conditions</Label>
                  <Textarea value={form.suitabilityConditions} onChange={(e) => field("suitabilityConditions", e.target.value)} rows={2} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-[13px]">Determination notes</Label>
                <Textarea value={form.suitabilityNotes} onChange={(e) => field("suitabilityNotes", e.target.value)} rows={3} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditingEmployeeId(null); setForm(null); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
