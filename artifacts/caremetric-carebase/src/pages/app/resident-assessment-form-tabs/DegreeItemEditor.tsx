import { memo, useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { DegreeItemAnswer, FormType, SectionItem } from "@/lib/residentAssessmentFormSchema";
import { DegreeSelect, FrequencyPartyFields } from "./fields";

// Memoized: this editor renders per-item (22 items in section1 alone), and every keystroke
// anywhere in the form used to re-render all of them because the onChange below was a fresh
// closure on every parent render. It only actually prevents re-renders because the call sites
// pass a per-item callback pulled from a handler map that's memoized once (see e.g.
// section1ItemHandlers below) instead of an inline arrow function -- `answer` is already
// reference-stable for every item except the one just edited, since `update()`'s immutable
// spreads never touch the other items' entries.
export const DegreeItemEditor = memo(function DegreeItemEditor({
  item,
  formType,
  answer,
  onChange,
  scale,
  readOnly,
}: {
  item: SectionItem;
  formType: FormType;
  answer: DegreeItemAnswer;
  onChange: (next: DegreeItemAnswer) => void;
  scale: { value: string; label: string }[];
  readOnly: boolean;
}) {
  const __fieldIds = useId();
  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm font-medium">{item.label}</p>
        <fieldset disabled={readOnly}>
          <DegreeSelect
            formType={formType}
            value={answer.degree}
            allOtherValue={answer.degreeAllOther}
            onChange={(v) =>
              onChange({ ...answer, degree: v, degreePreliminary: v })
            }
            onAllOtherChange={(v) => onChange({ ...answer, degreeAllOther: v })}
            scale={scale}
          />
        </fieldset>
      </div>
      <fieldset disabled={readOnly} className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <Checkbox
              id={`${__fieldIds}-service-need-na`}
              checked={answer.serviceNeedNotApplicable}
              onCheckedChange={(c) =>
                onChange({ ...answer, serviceNeedNotApplicable: !!c })
              }
            />
            <Label htmlFor={`${__fieldIds}-service-need-na`} className="text-xs">Assessment: not applicable</Label>
          </div>
          {!answer.serviceNeedNotApplicable && (
            <Textarea
              placeholder="Service need description"
              className="text-xs min-h-16"
              value={answer.serviceNeedDescription}
              onChange={(e) =>
                onChange({ ...answer, serviceNeedDescription: e.target.value })
              }
            />
          )}
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <Checkbox
              id={`${__fieldIds}-plan-na`}
              checked={answer.planNotApplicable}
              onCheckedChange={(c) =>
                onChange({ ...answer, planNotApplicable: !!c })
              }
            />
            <Label htmlFor={`${__fieldIds}-plan-na`} className="text-xs">Support plan: not applicable</Label>
          </div>
          {!answer.planNotApplicable && (
            <>
              <Textarea
                placeholder="Plan to meet the need"
                className="text-xs min-h-16"
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
                onFrequencyChange={(v) =>
                  onChange({ ...answer, planFrequency: v })
                }
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
            </>
          )}
        </div>
      </fieldset>
    </div>
  );
});
