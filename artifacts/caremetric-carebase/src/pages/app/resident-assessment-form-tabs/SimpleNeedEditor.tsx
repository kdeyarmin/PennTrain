import { memo, useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { FormType, SectionItem, SimpleNeedAnswer } from "@/lib/residentAssessmentFormSchema";
import { FrequencyPartyFields } from "./fields";

// Memoized for the same reason as DegreeItemEditor above -- callers must pass a stable per-item
// onChange (see section2SensoryHandlers/section4ItemHandlers) for this to actually take effect.
export const SimpleNeedEditor = memo(function SimpleNeedEditor({
  item,
  formType,
  answer,
  onChange,
  readOnly,
}: {
  item: SectionItem;
  formType: FormType;
  answer: SimpleNeedAnswer;
  onChange: (next: SimpleNeedAnswer) => void;
  readOnly: boolean;
}) {
  const __fieldIds = useId();
  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{item.label}</p>
        <fieldset disabled={readOnly} className="flex items-center gap-1.5">
          <Checkbox
            id={`${__fieldIds}-applicable`}
            checked={answer.applicable}
            onCheckedChange={(c) => onChange({ ...answer, applicable: !!c })}
          />
          <Label htmlFor={`${__fieldIds}-applicable`} className="text-xs">Applicable</Label>
        </fieldset>
      </div>
      {answer.applicable && (
        <fieldset disabled={readOnly} className="space-y-2">
          <Textarea
            placeholder="Description"
            className="text-xs min-h-14"
            value={answer.description}
            onChange={(e) =>
              onChange({ ...answer, description: e.target.value })
            }
          />
          <Textarea
            placeholder="Plan to meet the need"
            className="text-xs min-h-14"
            value={answer.planDescription}
            onChange={(e) =>
              onChange({ ...answer, planDescription: e.target.value })
            }
          />
          <FrequencyPartyFields
            formType={formType}
            frequency={answer.planFrequency}
            frequencyOther={answer.planFrequencyOther}
            responsibleParty={answer.planResponsibleParty}
            responsiblePartyOther={answer.planResponsiblePartyOther}
            onFrequencyChange={(v) => onChange({ ...answer, planFrequency: v })}
            onFrequencyOtherChange={(v) =>
              onChange({ ...answer, planFrequencyOther: v })
            }
            onPartyChange={(v) =>
              onChange({ ...answer, planResponsibleParty: v })
            }
            onPartyOtherChange={(v) =>
              onChange({ ...answer, planResponsiblePartyOther: v })
            }
          />
        </fieldset>
      )}
    </div>
  );
});
