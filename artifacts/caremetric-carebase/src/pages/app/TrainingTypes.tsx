import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Pencil, ListChecks } from "lucide-react";
import {
  useListTrainingTypes, useCreateTrainingType, useUpdateTrainingType,
  type TrainingType,
} from "@/hooks/useTrainingTypes";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

const FACILITY_SCOPE_OPTIONS = [
  { value: "BOTH", label: "All facility types" },
  { value: "PCH", label: "Personal Care Home" },
  { value: "ALR", label: "Assisted Living Facility" },
  { value: "NH", label: "Nursing Home" },
  { value: "HHA", label: "Home Health Agency" },
  { value: "HOS", label: "Hospice Agency" },
  { value: "GH", label: "Group Home" },
];

interface TypeFormData {
  name: string;
  category: string;
  description: string;
  appliesToFacilityType: string;
  renewalIntervalDays: string;
  requiredHours: string;
  warningDaysDefault: string;
  appliesToAdministersMeds: boolean;
  appliesToTrainers: boolean;
  documentRequired: boolean;
  citationNote: string;
}

function slugifyCode(name: string): string {
  return name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "CUSTOM";
}

const EMPTY_FORM: TypeFormData = {
  name: "", category: "", description: "", appliesToFacilityType: "BOTH",
  renewalIntervalDays: "365", requiredHours: "", warningDaysDefault: "90",
  appliesToAdministersMeds: false, appliesToTrainers: false, documentRequired: false, citationNote: "",
};

export default function TrainingTypes() {
  const { user } = useAuth();
  const { toast } = useToast();
  // Matches training_types_insert/_update/_delete RLS -- only org_admin (or platform_admin,
  // which doesn't reach this org-scoped page) can write; facility_manager sees a read-only
  // catalog, same pattern as Settings.tsx.
  const canManage = user?.role === "org_admin";

  const { data: trainingTypes, isLoading } = useListTrainingTypes();
  const createType = useCreateTrainingType();
  const updateType = useUpdateTrainingType();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TypeFormData>(EMPTY_FORM);

  const field = <K extends keyof TypeFormData>(k: K, v: TypeFormData[K]) =>
    setForm(f => ({ ...f, [k]: v }));

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (t: TrainingType) => {
    setEditingId(t.id);
    setForm({
      name: t.name,
      category: t.category,
      description: t.description ?? "",
      appliesToFacilityType: t.applies_to_facility_type,
      renewalIntervalDays: t.renewal_interval_days != null ? String(t.renewal_interval_days) : "",
      requiredHours: t.required_hours != null ? String(t.required_hours) : "",
      warningDaysDefault: String(t.warning_days_default),
      appliesToAdministersMeds: !!t.applies_to_administers_meds,
      appliesToTrainers: !!t.applies_to_trainers,
      documentRequired: t.document_required,
      citationNote: t.citation_note ?? "",
    });
    setShowForm(true);
  };

  const handleSave = () => {
    if (!user?.organizationId) return;
    if (!form.name.trim() || !form.category.trim()) {
      toast({ title: "Name and category are required", variant: "destructive" });
      return;
    }
    const payload = {
      name: form.name.trim(),
      category: form.category.trim(),
      description: form.description.trim() || null,
      applies_to_facility_type: form.appliesToFacilityType,
      renewal_interval_days: form.renewalIntervalDays.trim() ? Number(form.renewalIntervalDays) : null,
      required_hours: form.requiredHours.trim() ? Number(form.requiredHours) : null,
      warning_days_default: form.warningDaysDefault.trim() ? Number(form.warningDaysDefault) : 90,
      applies_to_administers_meds: form.appliesToAdministersMeds || null,
      applies_to_trainers: form.appliesToTrainers || null,
      document_required: form.documentRequired,
      citation_note: form.citationNote.trim() || null,
    };
    const onDone = {
      onSuccess: () => { toast({ title: editingId ? "Training type updated" : "Training type created" }); setShowForm(false); },
      onError: (e: Error) => toast({ title: "Failed to save", description: e.message, variant: "destructive" }),
    };
    if (editingId) updateType.mutate({ id: editingId, ...payload }, onDone);
    else createType.mutate({ ...payload, organization_id: user.organizationId, code: slugifyCode(form.name) }, onDone);
  };

  const systemTypes = (trainingTypes ?? []).filter(t => t.organization_id === null);
  const orgTypes = (trainingTypes ?? []).filter(t => t.organization_id !== null);

  const renderRow = (t: TrainingType, editable: boolean) => (
    <div key={t.id} className="flex items-center justify-between p-3 rounded-lg border">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium text-sm">{t.name}</p>
          <Badge variant="outline" className="text-xs">{t.category}</Badge>
          {!t.is_active && <Badge variant="secondary" className="text-xs">Inactive</Badge>}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {FACILITY_SCOPE_OPTIONS.find(o => o.value === t.applies_to_facility_type)?.label ?? t.applies_to_facility_type}
          {t.required_hours != null && Number(t.required_hours) > 0 ? ` · ${t.required_hours} hrs` : ""}
          {t.renewal_interval_days ? ` · renews every ${t.renewal_interval_days}d` : " · one-time"}
          {t.applies_to_administers_meds ? " · medication administration" : ""}
          {t.applies_to_trainers ? " · trainers" : ""}
        </p>
        {t.citation_note && <p className="text-xs text-muted-foreground mt-1 italic">{t.citation_note}</p>}
      </div>
      {editable && (
        <Button variant="outline" size="sm" onClick={() => openEdit(t)}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Training Types</h1>
          <p className="text-muted-foreground">Configure the training requirements your organization tracks compliance against.</p>
        </div>
        {canManage && (
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> Add Training Type
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5" /> Your Organization's Custom Types
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : orgTypes.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No custom training types yet -- the system defaults below cover the standard PA requirements.
            </p>
          ) : (
            <div className="space-y-2">{orgTypes.map(t => renderRow(t, canManage))}</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5" /> System Default Types
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : (
            <div className="space-y-2">{systemTypes.map(t => renderRow(t, false))}</div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showForm} onOpenChange={o => { if (!o) setShowForm(false); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Training Type" : "Add Training Type"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-[13px]">Name *</Label>
              <Input value={form.name} onChange={e => field("name", e.target.value)} placeholder="e.g. Facility-Specific Fall Prevention" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Category *</Label>
              <Input value={form.category} onChange={e => field("category", e.target.value)} placeholder="e.g. Resident Safety" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Applies To</Label>
              <Select value={form.appliesToFacilityType} onValueChange={v => field("appliesToFacilityType", v)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FACILITY_SCOPE_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-[13px]">Description</Label>
              <Textarea rows={2} value={form.description} onChange={e => field("description", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Required Hours</Label>
              <Input type="number" step="0.25" min="0" value={form.requiredHours} onChange={e => field("requiredHours", e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Renewal Interval (days)</Label>
              <Input type="number" min="0" value={form.renewalIntervalDays} onChange={e => field("renewalIntervalDays", e.target.value)} placeholder="Blank = one-time" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Warning Days</Label>
              <Input type="number" min="0" value={form.warningDaysDefault} onChange={e => field("warningDaysDefault", e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5 flex items-end">
              <label className="flex items-center gap-2 cursor-pointer pb-2">
                <input type="checkbox" checked={form.documentRequired} onChange={e => field("documentRequired", e.target.checked)} className="h-4 w-4" />
                <span className="text-sm">Documentation document required</span>
              </label>
            </div>
            <div className="col-span-2 flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.appliesToAdministersMeds} onChange={e => field("appliesToAdministersMeds", e.target.checked)} className="h-4 w-4" />
                <span className="text-sm">Medication administration staff only</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.appliesToTrainers} onChange={e => field("appliesToTrainers", e.target.checked)} className="h-4 w-4" />
                <span className="text-sm">Trainers only</span>
              </label>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-[13px]">Citation / Note</Label>
              <Textarea rows={2} value={form.citationNote} onChange={e => field("citationNote", e.target.value)} placeholder="Optional regulatory citation or internal note" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={createType.isPending || updateType.isPending}>
              {(createType.isPending || updateType.isPending) ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
