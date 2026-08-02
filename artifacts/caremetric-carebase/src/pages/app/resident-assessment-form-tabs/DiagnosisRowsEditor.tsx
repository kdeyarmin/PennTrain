import { useId } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  emptyDiagnosisRow,
  type DiagnosisRow,
  type FacilityCareDefaults,
  type FormType,
} from "@/lib/residentAssessmentFormSchema";
import { FrequencyPartyFields } from "./fields";

export function DiagnosisRowsEditor({
  title,
  rows,
  noneChecked,
  onRowsChange,
  onNoneChange,
  readOnly,
  maxRows,
  formType,
  planDefaults,
}: {
  title: string;
  rows: DiagnosisRow[];
  noneChecked: boolean;
  onRowsChange: (rows: DiagnosisRow[]) => void;
  onNoneChange: (v: boolean) => void;
  readOnly: boolean;
  maxRows: number;
  formType: FormType;
  planDefaults?: FacilityCareDefaults;
}) {
  const __fieldIds = useId();
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{title}</p>
        <fieldset disabled={readOnly} className="flex items-center gap-1.5">
          <Checkbox id={`${__fieldIds}-none`}
            checked={noneChecked}
            onCheckedChange={(c) => onNoneChange(!!c)}
          />
          <Label htmlFor={`${__fieldIds}-none`} className="text-xs">None</Label>
        </fieldset>
      </div>
      {!noneChecked && (
        <div className="space-y-2">
          {rows.map((row, i) => {
            const updateRow = (patch: Partial<DiagnosisRow>) =>
              onRowsChange(
                rows.map((r, j) => (j === i ? { ...r, ...patch } : r)),
              );
            return (
              <div key={i} className="border rounded-lg p-2 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Description"
                    className="h-8 text-xs"
                    value={row.description}
                    disabled={readOnly}
                    onChange={(e) => updateRow({ description: e.target.value })}
                  />
                  {!readOnly && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={() =>
                        onRowsChange(rows.filter((_, j) => j !== i))
                      }
                      aria-label="Remove diagnosis"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  )}
                </div>
                <Input
                  placeholder="Plan to meet the need"
                  className="h-8 text-xs"
                  value={row.planDescription}
                  disabled={readOnly}
                  onChange={(e) =>
                    updateRow({ planDescription: e.target.value })
                  }
                />
                <FrequencyPartyFields
                  formType={formType}
                  disabled={readOnly}
                  frequency={row.planFrequency}
                  frequencyOther={row.planFrequencyOther}
                  responsibleParty={row.planResponsibleParty}
                  responsiblePartyOther={row.planResponsiblePartyOther}
                  onFrequencyChange={(v) => updateRow({ planFrequency: v })}
                  onFrequencyOtherChange={(v) =>
                    updateRow({ planFrequencyOther: v })
                  }
                  onPartyChange={(v) => updateRow({ planResponsibleParty: v })}
                  onPartyOtherChange={(v) =>
                    updateRow({ planResponsiblePartyOther: v })
                  }
                />
              </div>
            );
          })}
          {!readOnly && rows.length < maxRows && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                onRowsChange([
                  ...rows,
                  {
                    ...emptyDiagnosisRow(),
                    ...(planDefaults?.responsibleParty
                      ? { planResponsibleParty: planDefaults.responsibleParty }
                      : {}),
                    ...(planDefaults?.frequency
                      ? { planFrequency: planDefaults.frequency }
                      : {}),
                  },
                ])
              }
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Add Row
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
