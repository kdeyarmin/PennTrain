import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useSaveResidentCareProfile } from "@/hooks/useResidentCareHeader";
import {
  AMBULATION_LABELS, CODE_STATUS_LABELS, COGNITIVE_STATUS_LABELS, ELOPEMENT_RISK_LABELS,
  FALL_RISK_LABELS, LEVEL_OF_CARE_LABELS, TRANSFER_ASSISTANCE_LABELS,
  type ResidentCareHeader,
} from "@/lib/residentCareHeader";

type CodedField =
  | "level_of_care" | "transfer_assistance" | "ambulation_status"
  | "fall_risk" | "elopement_risk" | "cognitive_status" | "code_status";

const CODED_FIELDS: { key: CodedField; label: string; options: Record<string, string> }[] = [
  { key: "level_of_care", label: "Level of care", options: LEVEL_OF_CARE_LABELS },
  { key: "ambulation_status", label: "Mobility", options: AMBULATION_LABELS },
  { key: "transfer_assistance", label: "Transfer assistance", options: TRANSFER_ASSISTANCE_LABELS },
  { key: "fall_risk", label: "Fall risk", options: FALL_RISK_LABELS },
  { key: "elopement_risk", label: "Elopement risk", options: ELOPEMENT_RISK_LABELS },
  { key: "cognitive_status", label: "Cognitive status", options: COGNITIVE_STATUS_LABELS },
  { key: "code_status", label: "Code status", options: CODE_STATUS_LABELS },
];

interface FormState extends Record<CodedField, string> {
  allergies: string;
  mobility_summary: string;
  supervision_requirements: string;
}

function toFormState(current: ResidentCareHeader): FormState {
  const { care } = current;
  return {
    level_of_care: care.levelOfCare,
    transfer_assistance: care.transferAssistance,
    ambulation_status: care.ambulationStatus,
    fall_risk: care.fallRisk,
    elopement_risk: care.elopementRisk,
    cognitive_status: care.cognitiveStatus,
    code_status: care.codeStatus,
    allergies: care.allergies.join(", "),
    mobility_summary: care.mobilitySummary ?? "",
    supervision_requirements: care.supervisionRequirements ?? "",
  };
}

export function EditResidentCareProfileDialog({
  open, onOpenChange, residentId, current,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  residentId: string;
  current: ResidentCareHeader;
}) {
  const { toast } = useToast();
  const save = useSaveResidentCareProfile();
  const [form, setForm] = useState<FormState>(() => toFormState(current));

  // Re-seed only when the dialog opens, so a background refetch cannot wipe in-progress edits.
  useEffect(() => {
    if (open) setForm(toFormState(current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSave = async () => {
    try {
      await save.mutateAsync({
        residentId,
        profile: {
          level_of_care: form.level_of_care,
          transfer_assistance: form.transfer_assistance,
          ambulation_status: form.ambulation_status,
          fall_risk: form.fall_risk,
          elopement_risk: form.elopement_risk,
          cognitive_status: form.cognitive_status,
          code_status: form.code_status,
          allergies: form.allergies.split(",").map((entry) => entry.trim()).filter(Boolean),
          mobility_summary: form.mobility_summary.trim() || null,
          supervision_requirements: form.supervision_requirements.trim() || null,
        },
      });
      toast({ title: "Care header updated", description: "Recorded as a care-header review on this resident." });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Could not update the care header",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit care header</DialogTitle>
          <DialogDescription>
            Saving stamps this as a care-header review. These coded values are what staff read at a glance —
            they do not replace the assessment or the support plan, and changing them here does not change either.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2 sm:grid-cols-2">
          {CODED_FIELDS.map((field) => (
            <div key={field.key} className="space-y-1">
              <Label className="text-xs" htmlFor={`care-${field.key}`}>{field.label}</Label>
              <Select value={form[field.key]} onValueChange={(value) => setForm((prev) => ({ ...prev, [field.key]: value }))}>
                <SelectTrigger id={`care-${field.key}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(field.options).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}

          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs" htmlFor="care-allergies">Non-food allergies (comma separated)</Label>
            <Input
              id="care-allergies"
              value={form.allergies}
              onChange={(event) => setForm((prev) => ({ ...prev, allergies: event.target.value }))}
              placeholder="Penicillin, latex"
            />
            <p className="text-[11px] text-muted-foreground">
              Food allergies are managed on the dietary profile and appear in the header alongside these.
            </p>
          </div>

          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs" htmlFor="care-mobility-summary">Mobility notes</Label>
            <Textarea
              id="care-mobility-summary"
              rows={2}
              value={form.mobility_summary}
              onChange={(event) => setForm((prev) => ({ ...prev, mobility_summary: event.target.value }))}
              placeholder="Context the coded value cannot carry — surfaces under Mobility in the header."
            />
          </div>

          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs" htmlFor="care-supervision">Supervision requirements</Label>
            <Textarea
              id="care-supervision"
              rows={2}
              value={form.supervision_requirements}
              onChange={(event) => setForm((prev) => ({ ...prev, supervision_requirements: event.target.value }))}
              placeholder="Surfaces under Cognition in the header."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancel</Button>
          <Button onClick={handleSave} disabled={save.isPending}>
            {save.isPending ? "Saving..." : "Save care header"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
