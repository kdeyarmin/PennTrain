import { useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useListProfiles } from "@/hooks/useProfiles";
import { useListFacilities } from "@/hooks/useFacilities";
import {
  useGetAdministratorProfileByProfileId, useUpsertAdministratorProfile,
  useListAdministratorCeEntries, useAddAdministratorCeEntry, useDeleteAdministratorCeEntry,
  useUploadAdministratorDocument, useAdministratorDocumentSignedUrl,
  type AdministratorProfile,
} from "@/hooks/useAdministratorProfiles";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { GraduationCap, FileCheck2, Send, Upload, Trash2, Download } from "lucide-react";
import { buildAdministratorRulePack, summarizeAdministratorRulePack } from "@/lib/administratorRulePacks";
import { toLocalIsoDate } from "@/lib/dateUtils";
import type { FacilityType } from "@/lib/facilityTypes";

const CE_SOURCE_OPTIONS = ["In-Service", "Conference", "Webinar", "Online Course", "Other"];
const ROLLING_WINDOW_HOURS_REQUIRED = 24;
const ROLLING_WINDOW_DAYS = 365;

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { dateStyle: "medium" });
}

function DocumentUploadRow({
  label, path, organizationId, profileId, onUploaded,
}: { label: string; path: string | null; organizationId: string; profileId: string; onUploaded: (path: string) => void }) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadAdministratorDocument();
  const getSignedUrl = useAdministratorDocumentSignedUrl();

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const newPath = await upload.mutateAsync({ file, organizationId, profileId });
      onUploaded(newPath);
      toast({ title: "Document uploaded" });
    } catch (err) {
      toast({ variant: "destructive", title: "Upload failed", description: err instanceof Error ? err.message : String(err) });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleView = async () => {
    if (!path) return;
    try {
      const url = await getSignedUrl.mutateAsync(path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast({ variant: "destructive", title: "Couldn't open document", description: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <Label className="text-[13px]">{label}</Label>
      <div className="flex items-center gap-2">
        {path && (
          <Button size="sm" variant="outline" onClick={handleView}><Download className="mr-1.5 h-3.5 w-3.5" /> View</Button>
        )}
        <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={upload.isPending}>
          <Upload className="mr-1.5 h-3.5 w-3.5" /> {upload.isPending ? "Uploading..." : path ? "Replace" : "Upload"}
        </Button>
        <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={handleUpload} />
      </div>
    </div>
  );
}

function AdministratorProfileEditor({ profileId, organizationId }: { profileId: string; organizationId: string }) {
  const { toast } = useToast();
  const { data: profile } = useGetAdministratorProfileByProfileId(profileId);
  const { mutateAsync: upsertProfile, isPending: savingProfile } = useUpsertAdministratorProfile();
  const { data: ceEntries } = useListAdministratorCeEntries(profile?.id);
  const { mutateAsync: addCeEntry, isPending: addingCe } = useAddAdministratorCeEntry();
  const { mutateAsync: deleteCeEntry } = useDeleteAdministratorCeEntry();
  const { data: facilities } = useListFacilities();

  const [ceForm, setCeForm] = useState({ hours: "", topic: "", source: CE_SOURCE_OPTIONS[0], completedDate: "", provider: "" });
  const [facilityTypePreview, setFacilityTypePreview] = useState<FacilityType>("PCH");

  const rollingTotal = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - ROLLING_WINDOW_DAYS);
    const cutoffStr = toLocalIsoDate(cutoff);
    return (ceEntries ?? [])
      .filter((e) => e.completed_date >= cutoffStr)
      .reduce((sum, e) => sum + Number(e.hours), 0);
  }, [ceEntries]);
  const facilityTypeOptions = useMemo(() => {
    const types = new Set<FacilityType>(["PCH", "ALR"]);
    for (const facility of facilities ?? []) {
      if (facility.facility_type === "PCH" || facility.facility_type === "ALR") types.add(facility.facility_type);
    }
    return Array.from(types);
  }, [facilities]);
  const administratorRulePack = useMemo(
    () => buildAdministratorRulePack(facilityTypePreview, { profile, ceEntries, today: toLocalIsoDate() }),
    [facilityTypePreview, profile, ceEntries],
  );
  const administratorRuleSummary = useMemo(() => summarizeAdministratorRulePack(administratorRulePack), [administratorRulePack]);

  const save = async (patch: Partial<AdministratorProfile>) => {
    try {
      await upsertProfile({
        organization_id: organizationId,
        profile_id: profileId,
        qualification_path: profile?.qualification_path ?? null,
        hundred_hour_course_completed_date: profile?.hundred_hour_course_completed_date ?? null,
        hundred_hour_course_provider: profile?.hundred_hour_course_provider ?? null,
        hundred_hour_course_document_path: profile?.hundred_hour_course_document_path ?? null,
        competency_test_passed: profile?.competency_test_passed ?? false,
        competency_test_date: profile?.competency_test_date ?? null,
        nha_license_number: profile?.nha_license_number ?? null,
        nha_license_state: profile?.nha_license_state ?? null,
        nha_license_expiration: profile?.nha_license_expiration ?? null,
        regional_office_verification_submitted_date: profile?.regional_office_verification_submitted_date ?? null,
        regional_office_verification_document_path: profile?.regional_office_verification_document_path ?? null,
        regional_office_verification_notes: profile?.regional_office_verification_notes ?? null,
        ...patch,
      });
      toast({ title: "Saved" });
    } catch (e) {
      toast({ variant: "destructive", title: "Couldn't save", description: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleAddCe = async () => {
    if (!profile?.id || !ceForm.hours || !ceForm.topic || !ceForm.completedDate) return;
    try {
      await addCeEntry({
        administrator_profile_id: profile.id,
        organization_id: organizationId,
        hours: Number(ceForm.hours),
        topic: ceForm.topic,
        source: ceForm.source,
        completed_date: ceForm.completedDate,
        provider: ceForm.provider || null,
      });
      setCeForm({ hours: "", topic: "", source: CE_SOURCE_OPTIONS[0], completedDate: "", provider: "" });
      toast({ title: "CE entry added" });
    } catch (e) {
      toast({ variant: "destructive", title: "Couldn't add CE entry", description: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle>Administrator rule pack</CardTitle>
              <CardDescription>Facility-type-specific PCH/ALF qualification, CE, orientation, and designee coverage documentation for inspection binders.</CardDescription>
            </div>
            <Badge className={administratorRuleSummary.ready ? "bg-success text-success-foreground hover:bg-success/80" : "bg-warning text-warning-foreground hover:bg-warning/80"}>
              {administratorRuleSummary.status.replaceAll("_", " ")}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5 max-w-xs">
            <Label className="text-[13px]">Preview facility type</Label>
            <Select value={facilityTypePreview} onValueChange={(v) => setFacilityTypePreview(v as FacilityType)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {facilityTypeOptions.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            {administratorRulePack.map((rule) => (
              <div key={rule.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-sm">{rule.label}</p>
                    <p className="text-xs text-muted-foreground">{rule.citation} · {rule.binderDestination}</p>
                  </div>
                  <Badge variant="outline" className="capitalize">{rule.status.replace("_", " ")}</Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{rule.detail}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><GraduationCap className="h-5 w-5" /> Qualification Path</CardTitle>
          <CardDescription>The 100-hour DHS-approved administrator course, or the NHA license exemption.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5 max-w-xs">
            <Label className="text-[13px]">Qualification Path</Label>
            <Select value={profile?.qualification_path ?? "unset"} onValueChange={(v) => save({ qualification_path: v === "unset" ? null : (v as AdministratorProfile["qualification_path"]) })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unset">Not yet determined</SelectItem>
                <SelectItem value="hundred_hour_course">100-Hour Administrator Course</SelectItem>
                <SelectItem value="nha_exemption">NHA License Exemption</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {profile?.qualification_path === "hundred_hour_course" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t">
              <div className="space-y-1.5">
                <Label className="text-[13px]">Training Course Completed Date</Label>
                <Input type="date" defaultValue={profile.hundred_hour_course_completed_date ?? ""} onBlur={(e) => save({ hundred_hour_course_completed_date: e.target.value || null })} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Training Course Provider</Label>
                <Input defaultValue={profile.hundred_hour_course_provider ?? ""} onBlur={(e) => save({ hundred_hour_course_provider: e.target.value || null })} className="h-9" />
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <Checkbox checked={profile.competency_test_passed} onCheckedChange={(v) => save({ competency_test_passed: !!v })} />
                Competency test passed
              </label>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Competency Test Date</Label>
                <Input type="date" defaultValue={profile.competency_test_date ?? ""} onBlur={(e) => save({ competency_test_date: e.target.value || null })} className="h-9" />
              </div>
              <div className="sm:col-span-2">
                <DocumentUploadRow
                  label="Training Course Certificate"
                  path={profile.hundred_hour_course_document_path}
                  organizationId={organizationId}
                  profileId={profileId}
                  onUploaded={(path) => save({ hundred_hour_course_document_path: path })}
                />
              </div>
            </div>
          )}

          {profile?.qualification_path === "nha_exemption" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t">
              <div className="space-y-1.5">
                <Label className="text-[13px]">NHA License Number</Label>
                <Input defaultValue={profile.nha_license_number ?? ""} onBlur={(e) => save({ nha_license_number: e.target.value || null })} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Licensing State</Label>
                <Input defaultValue={profile.nha_license_state ?? ""} onBlur={(e) => save({ nha_license_state: e.target.value || null })} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">License Expiration</Label>
                <Input type="date" defaultValue={profile.nha_license_expiration ?? ""} onBlur={(e) => save({ nha_license_expiration: e.target.value || null })} className="h-9" />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Send className="h-5 w-5" /> Regional Office Verification</CardTitle>
          <CardDescription>Written notice of administrator qualifications submitted to the DHS regional office.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-[13px]">Submitted Date</Label>
              <Input type="date" defaultValue={profile?.regional_office_verification_submitted_date ?? ""} onBlur={(e) => save({ regional_office_verification_submitted_date: e.target.value || null })} className="h-9" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px]">Notes</Label>
            <Textarea defaultValue={profile?.regional_office_verification_notes ?? ""} onBlur={(e) => save({ regional_office_verification_notes: e.target.value || null })} rows={2} />
          </div>
          <DocumentUploadRow
            label="Proof of Submission"
            path={profile?.regional_office_verification_document_path ?? null}
            organizationId={organizationId}
            profileId={profileId}
            onUploaded={(path) => save({ regional_office_verification_document_path: path })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="flex items-center gap-2"><FileCheck2 className="h-5 w-5" /> Continuing Education</CardTitle>
            <Badge className={rollingTotal >= ROLLING_WINDOW_HOURS_REQUIRED ? "bg-success text-success-foreground hover:bg-success/80" : "bg-warning text-warning-foreground hover:bg-warning/80"}>
              {rollingTotal.toFixed(1)} / {ROLLING_WINDOW_HOURS_REQUIRED} hrs (trailing 12 months)
            </Badge>
          </div>
          <CardDescription>Rolling 24-hour annual CE requirement, with source and documentation captured per entry.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Hours</Label>
              <Input type="number" step="0.5" min="0.5" value={ceForm.hours} onChange={(e) => setCeForm((f) => ({ ...f, hours: e.target.value }))} className="h-9" />
            </div>
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">Topic</Label>
              <Input value={ceForm.topic} onChange={(e) => setCeForm((f) => ({ ...f, topic: e.target.value }))} className="h-9" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Source</Label>
              <Select value={ceForm.source} onValueChange={(v) => setCeForm((f) => ({ ...f, source: v }))}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CE_SOURCE_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Date</Label>
              <Input type="date" value={ceForm.completedDate} onChange={(e) => setCeForm((f) => ({ ...f, completedDate: e.target.value }))} className="h-9" />
            </div>
            <div className="col-span-2 sm:col-span-5">
              <Button size="sm" onClick={handleAddCe} disabled={addingCe || !ceForm.hours || !ceForm.topic || !ceForm.completedDate}>
                {addingCe ? "Adding..." : "Add Entry"}
              </Button>
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t">
            {!ceEntries?.length ? (
              <p className="text-sm text-muted-foreground text-center py-4">No CE entries recorded yet.</p>
            ) : (
              ceEntries.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between gap-3 p-2.5 rounded-lg border text-sm">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{entry.topic} <span className="text-muted-foreground font-normal">· {entry.hours}h</span></p>
                    <p className="text-xs text-muted-foreground">{fmtDate(entry.completed_date)} · {entry.source ?? "—"} {entry.provider ? `· ${entry.provider}` : ""}</p>
                  </div>
                  <Button
                    size="icon" variant="ghost" className="h-8 w-8 text-destructive shrink-0"
                    onClick={() => deleteCeEntry({ id: entry.id, administratorProfileId: entry.administrator_profile_id })}
                    aria-label="Delete CE entry"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {savingProfile && <p className="text-xs text-muted-foreground">Saving...</p>}
    </div>
  );
}

export default function AdministratorQualification() {
  const { user } = useAuth();
  const isSelfService = user?.role === "facility_manager";
  const { data: administrators } = useListProfiles({ organizationId: user?.organizationId ?? undefined, role: "facility_manager" });
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);

  const activeProfileId = isSelfService ? user?.id ?? null : selectedProfileId;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Administrator Qualification &amp; CE</h1>
        <p className="text-muted-foreground">
          The 100-hour course record, competency test, NHA exemption, regional-office verification, and rolling CE log — the first file pulled at inspection.
        </p>
      </div>

      {!isSelfService && (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-1.5 max-w-sm">
              <Label className="text-[13px]">Administrator</Label>
              <Select value={selectedProfileId ?? ""} onValueChange={setSelectedProfileId}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select an administrator" /></SelectTrigger>
                <SelectContent>
                  {(administrators ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.first_name} {p.last_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      {activeProfileId && user?.organizationId && (
        <AdministratorProfileEditor profileId={activeProfileId} organizationId={user.organizationId} />
      )}
    </div>
  );
}
