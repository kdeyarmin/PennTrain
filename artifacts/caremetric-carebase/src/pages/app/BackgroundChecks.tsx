import { useId, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { facilityDaysUntil } from "@/lib/dateUtils";
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
import { QueryError } from "@/components/QueryState";
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
  // Count whole PA facility calendar days so the badge agrees with server/regulatory windows.
  const daysElapsed = -(facilityDaysUntil(profile.provisional_start_date) ?? 0);
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
  const __fieldIds = useId();
  const { user } = useAuth();
  const { toast } = useToast();
  const [facilityFilter, setFacilityFilter] = useState("all");
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [form, setForm] = useState<ProfileFormData | null>(null);

  const { data: facilities } = useListFacilities();
  const {
    data: employees,
    isLoading: employeesLoading,
    isError: employeesError,
    error: employeesErrorDetail,
    refetch: refetchEmployees,
  } = useListEmployees({ status: "active" });
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

    // The "_at" columns record WHEN something was attested, and every save was stamping them
    // `now()` whenever the flag was true -- so re-opening this profile to correct a typo in the
    // notes moved the date the non-disqualification statement was signed, the date supervision was
    // confirmed, and the date suitability was determined, all to today. Those are the dates a
    // surveyor asks for on an OAPSA record, and the answer had become "the last time anyone
    // touched this form".
    //
    // The actor travels WITH the timestamp. Preserving `_at` while still writing the current
    // user into `_by` would be worse than the original bug rather than better: the pair would
    // then disagree, attributing an attestation made in March by one administrator to whoever
    // edited the notes in August. An attestation is one fact -- who, and when -- so it is
    // preserved or stamped as a unit, and cleared as a unit.
    const existing = profileByEmployeeId.get(editingEmployeeId);
    const attestation = (
      isSet: boolean,
      wasSet: boolean,
      previousAt: string | null | undefined,
      previousBy: string | null | undefined,
    ): { at: string | null; by: string | null } => {
      if (!isSet) return { at: null, by: null };
      if (wasSet && previousAt) return { at: previousAt, by: previousBy ?? null };
      return { at: new Date().toISOString(), by: user.id };
    };

    const supervision = attestation(
      form.supervisionConfirmed,
      existing?.supervision_attestation_confirmed === true,
      existing?.supervision_attestation_confirmed_at,
      existing?.supervision_attestation_confirmed_by,
    );
    // A CHANGED determination is a new determination, not the old one re-saved -- so this is
    // preserved only while the verdict itself is unchanged.
    const suitability = attestation(
      form.suitabilityDetermination !== "pending",
      existing?.suitability_determination === form.suitabilityDetermination
        && existing?.suitability_determination !== "pending",
      existing?.suitability_determined_at,
      existing?.suitability_determined_by,
    );
    const nonDisqSignedAt = attestation(
      form.nonDisqStatementSigned,
      existing?.non_disqualification_statement_signed === true,
      existing?.non_disqualification_statement_signed_at,
      null,
    ).at;

    const paResident = form.paResidentTwoYears === "yes" ? true : form.paResidentTwoYears === "no" ? false : null;
    const provisionalMaxDays = form.provisionalStartDate
      ? (paResident === true
          ? orgSettings?.oapsa_provisional_days_resident ?? 30
          : orgSettings?.oapsa_provisional_days_nonresident ?? 90)
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
        non_disqualification_statement_signed_at: nonDisqSignedAt,
        supervision_attestation_confirmed: form.supervisionConfirmed,
        supervision_attestation_confirmed_by: supervision.by,
        supervision_attestation_confirmed_at: supervision.at,
        supervision_attestation_notes: form.supervisionNotes || null,
        suitability_determination: form.suitabilityDetermination,
        suitability_conditions: form.suitabilityConditions || null,
        suitability_determined_by: suitability.by,
        suitability_determined_at: suitability.at,
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
          {employeesError ? (
            <QueryError what="the employee roster" error={employeesErrorDetail} onRetry={() => refetchEmployees()} />
          ) : employeesLoading ? (
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
                <Label htmlFor={`${__fieldIds}-pa-resident-for-the-preceding-2-years`} className="text-[13px]">PA resident for the preceding 2 years?</Label>
                <Select value={form.paResidentTwoYears} onValueChange={(v) => field("paResidentTwoYears", v)}>
                  <SelectTrigger id={`${__fieldIds}-pa-resident-for-the-preceding-2-years`} className="h-9"><SelectValue /></SelectTrigger>
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
                <Label htmlFor={`${__fieldIds}-provisional-employment-start-date`} className="text-[13px]">Provisional employment start date</Label>
                <Input id={`${__fieldIds}-provisional-employment-start-date`} type="date" value={form.provisionalStartDate} onChange={(e) => field("provisionalStartDate", e.target.value)} className="h-9" />
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
                <Label htmlFor={`${__fieldIds}-supervision-notes`} className="text-[13px]">Supervision notes</Label>
                <Textarea id={`${__fieldIds}-supervision-notes`} value={form.supervisionNotes} onChange={(e) => field("supervisionNotes", e.target.value)} rows={2} />
              </div>

              <div className="space-y-1.5 pt-2 border-t">
                <Label htmlFor={`${__fieldIds}-suitability-determination`} className="text-[13px]">Suitability determination</Label>
                <Select value={form.suitabilityDetermination} onValueChange={(v) => field("suitabilityDetermination", v as ProfileFormData["suitabilityDetermination"])}>
                  <SelectTrigger id={`${__fieldIds}-suitability-determination`} className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(SUITABILITY_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {form.suitabilityDetermination === "suitable_with_conditions" && (
                <div className="space-y-1.5">
                  <Label htmlFor={`${__fieldIds}-conditions`} className="text-[13px]">Conditions</Label>
                  <Textarea id={`${__fieldIds}-conditions`} value={form.suitabilityConditions} onChange={(e) => field("suitabilityConditions", e.target.value)} rows={2} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor={`${__fieldIds}-determination-notes`} className="text-[13px]">Determination notes</Label>
                <Textarea id={`${__fieldIds}-determination-notes`} value={form.suitabilityNotes} onChange={(e) => field("suitabilityNotes", e.target.value)} rows={3} />
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
