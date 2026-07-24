import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListProfiles } from "@/hooks/useProfiles";
import {
  useComplianceFacilityBuildings,
  useUpsertComplianceRequirement,
  type ComplianceRequirement,
} from "@/hooks/useComplianceRequirements";
import { COMPLIANCE_CATEGORIES, RECURRENCE_OPTIONS, CHAPTER_OPTIONS } from "@/lib/complianceCommandCenter";
import { toLocalIsoDate } from "@/lib/dateUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";

const NONE = "__none__";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requirement?: ComplianceRequirement | null;
  isTemplate?: boolean;
  defaultFacilityId?: string;
}

interface FormState {
  facilityId: string;
  buildingId: string;
  category: string;
  title: string;
  description: string;
  regulationCitation: string;
  regulationChapter: string;
  responsibleProfileId: string;
  recurrence: string;
  customIntervalDays: string;
  anchorDate: string;
  warningDays: string;
  requiresEvidence: boolean;
  requiresReview: boolean;
}

function fromRequirement(r: ComplianceRequirement | null | undefined, defaultFacilityId: string, isTemplate: boolean): FormState {
  return {
    facilityId: r?.facility_id ?? defaultFacilityId ?? "",
    buildingId: r?.building_id ?? "",
    category: r?.category ?? "policies_procedures",
    title: r?.title ?? "",
    description: r?.description ?? "",
    regulationCitation: r?.regulation_citation ?? "",
    regulationChapter: r?.regulation_chapter ?? "",
    responsibleProfileId: r?.responsible_profile_id ?? "",
    recurrence: r?.recurrence ?? (isTemplate ? "annual" : "annual"),
    customIntervalDays: r?.custom_interval_days ? String(r.custom_interval_days) : "",
    anchorDate: r?.anchor_date ?? toLocalIsoDate(),
    warningDays: String(r?.warning_days ?? 14),
    requiresEvidence: r?.requires_evidence ?? true,
    requiresReview: r?.requires_review ?? false,
  };
}

export function RequirementEditorDialog({ open, onOpenChange, requirement, isTemplate = false, defaultFacilityId = "" }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: facilities } = useListFacilities();
  const { data: profiles } = useListProfiles();
  const upsert = useUpsertComplianceRequirement();

  const editing = !!requirement;
  const effectiveTemplate = requirement ? requirement.is_template : isTemplate;

  const [form, setForm] = useState<FormState>(() => fromRequirement(requirement, defaultFacilityId, isTemplate));

  useEffect(() => {
    if (open) setForm(fromRequirement(requirement, defaultFacilityId, isTemplate));
  }, [open, requirement, defaultFacilityId, isTemplate]);

  const { data: buildings } = useComplianceFacilityBuildings(effectiveTemplate ? undefined : form.facilityId || undefined);

  const orgProfiles = useMemo(
    () => (profiles ?? []).filter((p) => p.is_active && ["org_admin", "facility_manager", "trainer"].includes(p.role)),
    [profiles],
  );

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (!form.title.trim()) {
      toast({ title: "Title required", description: "Give the requirement a name.", variant: "destructive" });
      return;
    }
    if (!effectiveTemplate && !form.facilityId) {
      toast({ title: "Facility required", description: "Choose the facility this requirement applies to.", variant: "destructive" });
      return;
    }
    if (form.recurrence === "custom" && (!form.customIntervalDays || Number(form.customIntervalDays) < 1)) {
      toast({ title: "Interval required", description: "Enter the number of days for a custom cadence.", variant: "destructive" });
      return;
    }
    try {
      await upsert.mutateAsync({
        id: requirement?.id ?? null,
        facilityId: effectiveTemplate ? null : form.facilityId,
        buildingId: effectiveTemplate || !form.buildingId ? null : form.buildingId,
        category: form.category,
        title: form.title.trim(),
        description: form.description.trim() || null,
        regulationCitation: form.regulationCitation.trim() || null,
        regulationChapter: form.regulationChapter || null,
        responsibleProfileId: form.responsibleProfileId || null,
        recurrence: form.recurrence,
        customIntervalDays: form.recurrence === "custom" ? Number(form.customIntervalDays) : null,
        anchorDate: form.anchorDate || null,
        warningDays: Number.isFinite(Number(form.warningDays)) && Number(form.warningDays) >= 0 ? Number(form.warningDays) : 14,
        requiresEvidence: form.requiresEvidence,
        requiresReview: form.requiresReview,
        isTemplate: effectiveTemplate,
        organizationId: user?.organizationId ?? null,
      });
      toast({ title: editing ? "Requirement updated" : effectiveTemplate ? "Template created" : "Requirement created" });
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Could not save", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit" : "New"} {effectiveTemplate ? "template" : "compliance requirement"}
          </DialogTitle>
          <DialogDescription>
            {effectiveTemplate
              ? "Templates aren't tracked directly — copy them into facilities to create live, scheduled requirements."
              : "Define a recurring obligation. Occurrences are generated on a schedule and tracked to completion."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="cc-title">Title</Label>
            <Input id="cc-title" value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="e.g. Monthly fire drill log" />
          </div>

          {!effectiveTemplate && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Facility</Label>
                <Select value={form.facilityId} onValueChange={(v) => { update("facilityId", v); update("buildingId", ""); }} disabled={editing}>
                  <SelectTrigger><SelectValue placeholder="Select facility" /></SelectTrigger>
                  <SelectContent>
                    {(facilities ?? []).map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Building <span className="text-muted-foreground">(optional)</span></Label>
                <Select value={form.buildingId || NONE} onValueChange={(v) => update("buildingId", v === NONE ? "" : v)} disabled={!form.facilityId}>
                  <SelectTrigger><SelectValue placeholder="Whole facility" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Whole facility</SelectItem>
                    {(buildings ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Category</Label>
              <Select value={form.category} onValueChange={(v) => update("category", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COMPLIANCE_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Responsible person <span className="text-muted-foreground">(optional)</span></Label>
              <Select value={form.responsibleProfileId || NONE} onValueChange={(v) => update("responsibleProfileId", v === NONE ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Unassigned</SelectItem>
                  {orgProfiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.first_name} {p.last_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="cc-reg">Regulation citation <span className="text-muted-foreground">(optional)</span></Label>
              <Input id="cc-reg" value={form.regulationCitation} onChange={(e) => update("regulationCitation", e.target.value)} placeholder="e.g. 55 Pa. Code § 2600.132" />
            </div>
            <div className="grid gap-2">
              <Label>Regulation chapter</Label>
              <Select value={form.regulationChapter || NONE} onValueChange={(v) => update("regulationChapter", v === NONE ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {CHAPTER_OPTIONS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="cc-desc">Description / instructions <span className="text-muted-foreground">(optional)</span></Label>
            <Textarea id="cc-desc" value={form.description} onChange={(e) => update("description", e.target.value)} rows={2} />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label>Cadence</Label>
              <Select value={form.recurrence} onValueChange={(v) => update("recurrence", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RECURRENCE_OPTIONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {form.recurrence === "custom" && (
              <div className="grid gap-2">
                <Label htmlFor="cc-interval">Every N days</Label>
                <Input id="cc-interval" type="number" min={1} value={form.customIntervalDays} onChange={(e) => update("customIntervalDays", e.target.value)} />
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="cc-anchor">{form.recurrence === "one_time" ? "Due date" : "First due date"}</Label>
              <Input id="cc-anchor" type="date" value={form.anchorDate} onChange={(e) => update("anchorDate", e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cc-warn">Remind (days before)</Label>
              <Input id="cc-warn" type="number" min={0} max={365} value={form.warningDays} onChange={(e) => update("warningDays", e.target.value)} />
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.requiresEvidence} onCheckedChange={(v) => update("requiresEvidence", v)} />
              Requires supporting evidence
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.requiresReview} onCheckedChange={(v) => update("requiresReview", v)} />
              Requires supervisor review
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={upsert.isPending}>
            {upsert.isPending ? "Saving…" : editing ? "Save changes" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
